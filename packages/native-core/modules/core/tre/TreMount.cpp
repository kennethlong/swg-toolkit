/**
 * TreMount.cpp — Priority-based TRE virtual filesystem mount resolver implementation.
 *
 * Source citations (ground truth):
 *   swg-client-v2 TreeFile.cpp:285-308  (priority sort + std::lower_bound insert)
 *   swg-client-v2 TreeFile.cpp:437-461  (find(): first-match-wins traverse)
 *   swg-client-v2 TreeFile.cpp:511-601  (fixUpFileName)
 *   swg-client-v2 TreeFile_SearchNode.cpp:360-408 (binary search + tombstone detection)
 *
 * See TreMount.h for the full design doc.
 */

#include "TreMount.h"
#include <algorithm>
#include <cctype>
#include <cstring>
#include <unordered_map>
#include <string_view>
#include <cstdint>

namespace swg {

// ─── version string helper ──────────────────────────────────────────────────────

/** Map a TreVersion enum to its canonical "vNNNN" string (matches index.d.ts). */
static std::string versionToString(TreVersion v) {
    switch (v) {
        case TreVersion::V0004: return "v0004";
        case TreVersion::V0005: return "v0005";
        case TreVersion::V0006: return "v0006";
        case TreVersion::V5000: return "v5000";
        case TreVersion::V6000: return "v6000";
    }
    return "unknown";
}

// ─── addArchive ───────────────────────────────────────────────────────────────

void TreMount::addArchive(std::unique_ptr<TreArchive> archive,
                          std::string path,
                          int priority)
{
    /**
     * Insertion strategy: mirror swg-client-v2 TreeFile.cpp:304 exactly.
     *
     *   insertionPoint = std::lower_bound(begin, end, newNode, predicate)
     *   predicate(a, b) = a.priority > b.priority
     *
     * std::lower_bound returns the FIRST position where predicate(element, new) is FALSE,
     * i.e., the FIRST position where !(existing.priority > new.priority)
     *       = the FIRST position where existing.priority <= new.priority.
     *
     * For EQUAL priorities: the very first element in the equal-priority run satisfies
     * existing.priority <= new.priority (both equal), so the new node inserts BEFORE
     * that run — the most recently added equal-priority archive ends up at the front
     * of the equal-priority block and therefore wins.
     *
     * This code-vs-comment ambiguity is documented in the header. The test
     * "tre priority tie-break" pins this exact behavior.
     *
     * Source: swg-client-v2 TreeFile.cpp:285-308.
     */
    TreMountNode node;
    node.archive  = std::move(archive);
    node.path     = std::move(path);
    node.priority = priority;

    auto it = std::lower_bound(
        m_nodes.begin(), m_nodes.end(), node,
        [](const TreMountNode& existing, const TreMountNode& newNode) {
            return existing.priority > newNode.priority;
        }
    );
    m_nodes.insert(it, std::move(node));
}

// ─── fixUpFileName ────────────────────────────────────────────────────────────

std::string TreMount::fixUpFileName(const std::string& rawName)
{
    /**
     * Ported from swg-client-v2 TreeFile.cpp:511-601 (fixUpFileName).
     *
     * Steps (in order, matching the client):
     * 1. Strip leading '/' and '\'  (:528-539)
     * 2. Strip leading './' and '.\' (:541-553)
     * 3. Strip leading '../' and '..\' (:555-567)
     * 4. Lowercase all chars; convert '\' to '/'; collapse repeated '/' (:569-598)
     */
    const char* f = rawName.c_str();

    // Step 1: strip leading slashes
    while (f[0] == '\\' || f[0] == '/')
        ++f;

    // Step 2: strip leading "./" or ".\"
    while (f[0] == '.' && (f[1] == '\\' || f[1] == '/'))
        f += 2;

    // Step 3: strip leading "../" or "..\"
    while (f[0] == '.' && f[1] == '.' && (f[2] == '\\' || f[2] == '/'))
        f += 3;

    // Step 4: lowercase + backslash->slash + collapse repeated slashes
    std::string result;
    result.reserve(strlen(f));
    bool prevSlash = false;
    for (; *f; ++f) {
        const char c = *f;
        if (c == '\\' || c == '/') {
            if (!prevSlash) {
                result += '/';
                prevSlash = true;
            }
            // else: skip repeated slash
        } else {
            result += static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
            prevSlash = false;
        }
    }
    return result;
}

// ─── globMatch ────────────────────────────────────────────────────────────────

bool TreMount::globMatch(const std::string& pattern, const std::string& text)
{
    /**
     * Simple glob matching: * = any sequence (including empty), ? = single char.
     * Case-insensitive (both pattern and text lowercased by the search() wrapper).
     *
     * Source: OUR design (RESEARCH.md § "TRE Search Semantics").
     * Uses a classic DP / two-pointer approach for * support.
     */
    const char* p  = pattern.c_str();
    const char* t  = text.c_str();
    const char* pstar = nullptr; // last '*' position in pattern
    const char* tstar = nullptr; // position in text when '*' was matched

    while (*t) {
        if (*p == '*') {
            pstar = p++;
            tstar = t;
        } else if (*p == '?' || *p == *t) {
            ++p;
            ++t;
        } else if (pstar) {
            // Backtrack: '*' absorbs one more character of text
            p = pstar + 1;
            t = ++tstar;
        } else {
            return false;
        }
    }
    // Skip trailing '*' in pattern
    while (*p == '*') ++p;
    return (*p == '\0');
}

// ─── resolve ─────────────────────────────────────────────────────────────────

TreMountResolveResult TreMount::resolve(const std::string& rawName) const
{
    /**
     * First-match-wins traverse over the priority-sorted node list.
     * Mirrors swg-client-v2 TreeFile.cpp:437-461 (find()).
     *
     * The client traverses the sorted list and returns the first node that reports
     * the file exists (found OR tombstone). We do the same: the first archive that
     * has an entry for `name` wins, regardless of whether it's a tombstone.
     *
     * Source: swg-client-v2 TreeFile.cpp:437-461.
     */
    const std::string name = fixUpFileName(rawName);

    for (int i = 0; i < static_cast<int>(m_nodes.size()); ++i) {
        const TreMountNode& node = m_nodes[i];
        bool deleted = false;
        const int idx = node.archive->resolve(name, deleted);

        if (idx >= 0) {
            // Found (real entry)
            TreMountResolveResult r;
            r.winner       = node.path;
            r.tombstone    = false;
            r.archiveIndex = i;
            r.entryIndex   = idx;
            return r;
        }

        if (deleted) {
            // Tombstone: the entry exists but has length==0 (file deleted/shadowed)
            // Source: TreeFile_SearchNode.cpp:397-401 (client stops at first tombstone)
            // Our resolve() also stops here; the file is considered deleted for the whole mount.
            TreMountResolveResult r;
            r.winner       = node.path; // the tombstone archive is the "winner"
            r.tombstone    = true;
            r.archiveIndex = i;
            // Find the entry index for the tombstone entry so we can return it
            // We need to find the entry that was marked deleted
            // The resolve() call returned -1 with deleted=true, meaning the entry
            // was found in the TOC but has length==0. We need the actual entry index.
            // Unfortunately TreArchive::resolve() only returns the index when non-deleted.
            // We need to resolve the raw index including tombstones.
            r.entryIndex   = node.archive->resolveTombstoneIndex(name);
            return r;
        }
    }

    // Not found in any archive
    TreMountResolveResult r;
    r.winner       = "";
    r.tombstone    = false;
    r.archiveIndex = -1;
    r.entryIndex   = -1;
    return r;
}

// ─── resolveChain ─────────────────────────────────────────────────────────────

TreShadowChain TreMount::resolveChain(const std::string& rawName) const
{
    /**
     * OUR algorithm (the client does not report shadow chains).
     *
     * Walk the ENTIRE priority list, collecting every archive containing `name`
     * (real or tombstone). The winner is the first one found (highest priority).
     * All subsequent matches go into `shadows` in priority order (highest first).
     *
     * Invariant: for the non-tombstone case, chain.winner == resolve(name).winner.
     * For tombstone winner: chain.tombstone == true, chain.winner == tombstone archive path.
     *
     * Source: OUR design; see 01-02-PLAN.md <ground_truth> § resolveChain.
     */
    const std::string name = fixUpFileName(rawName);

    TreShadowChain chain;
    chain.tombstone           = false;
    chain.winnerArchiveIndex  = -1;
    chain.winnerEntryIndex    = -1;
    bool winnerFound = false;

    for (int i = 0; i < static_cast<int>(m_nodes.size()); ++i) {
        const TreMountNode& node = m_nodes[i];
        bool deleted = false;
        int idx = node.archive->resolve(name, deleted);

        bool hasEntry = (idx >= 0) || deleted;
        if (!hasEntry) continue;

        if (!winnerFound) {
            // This is the winner (highest priority match)
            chain.winner             = node.path;
            chain.tombstone          = deleted;
            chain.winnerArchiveIndex = i;
            chain.winnerEntryIndex   = deleted
                ? node.archive->resolveTombstoneIndex(name)
                : idx;
            winnerFound = true;
        } else {
            // This is a shadowed archive
            chain.shadows.push_back(node.path);
        }
    }

    return chain;
}

// ─── search ──────────────────────────────────────────────────────────────────

std::vector<TreSearchHitNative> TreMount::search(const std::string& text, bool glob) const
{
    /**
     * Case-insensitive search over the flat name lists of all mounted archives.
     *
     * Strategy: for each mounted archive, iterate its entries and check if the
     * normalized name matches the query. Returns matched INDICES only — never
     * the full name list (T-01-06: do not ship 100k+ names to JS per keystroke).
     *
     * Mode 'substring': case-insensitive substring check (std::string::find).
     * Mode 'glob': * / ? wildcards (globMatch).
     *
     * Source: RESEARCH.md § "TRE Search Semantics"; T-01-06 disposition.
     */
    // Lowercase the query once
    std::string lowerText;
    lowerText.reserve(text.size());
    for (char c : text)
        lowerText += static_cast<char>(std::tolower(static_cast<unsigned char>(c)));

    std::vector<TreSearchHitNative> hits;

    for (int ai = 0; ai < static_cast<int>(m_nodes.size()); ++ai) {
        const TreMountNode& node = m_nodes[ai];
        const auto& entries = node.archive->entries();

        for (int ei = 0; ei < static_cast<int>(entries.size()); ++ei) {
            // Use namePtr() — zero-copy pointer into the name block (perf fix #2/#3)
            const char* np = node.archive->namePtr(entries[ei].fileNameOffset);
            if (!np || np[0] == '\0') continue;

            // Name is already lowercase (normalized by TreArchive)
            const std::string entryName(np);

            bool matched = false;
            if (glob) {
                matched = globMatch(lowerText, entryName);
            } else {
                // Substring: case-insensitive (both already lowercase)
                matched = (entryName.find(lowerText) != std::string::npos);
            }

            if (matched) {
                TreSearchHitNative hit;
                hit.entryIndex   = ei;
                hit.archiveIndex = ai;
                hits.push_back(hit);
            }
        }
    }

    return hits;
}

// ─── archiveInfos ───────────────────────────────────────────────────────────────

std::vector<TreMountArchiveInfo> TreMount::archiveInfos() const
{
    /**
     * One entry per mounted archive, in priority-sorted order (archiveIndex = node
     * list position — the SAME space as search()/resolve()/resolveChain() hits).
     *
     * Source: OUR design — 01-02-PLAN.md index-space-mismatch fix.
     */
    std::vector<TreMountArchiveInfo> infos;
    infos.reserve(m_nodes.size());

    for (int i = 0; i < static_cast<int>(m_nodes.size()); ++i) {
        const TreMountNode& node = m_nodes[i];
        const TreVersion ver = node.archive->version();

        TreMountArchiveInfo info;
        info.path          = node.path;
        info.version       = versionToString(ver);
        info.enumerateOnly = isEnumerateOnly(ver);
        info.entryCount    = node.archive->entryCount();
        info.priority      = node.priority;
        info.archiveIndex  = i;
        infos.push_back(std::move(info));
    }

    return infos;
}

// ─── vfsEntries ─────────────────────────────────────────────────────────────────

std::vector<TreMountVfsEntry> TreMount::vfsEntries() const
{
    /**
     * Deduplicated, shadow-resolved VFS for the whole mount. For every unique
     * normalized path, the winner is the first (highest-priority) archive in node
     * order; lower-priority archives containing the same path add to shadowCount.
     *
     * Archive names are already normalized (lowercase, forward-slash) by TreArchive,
     * so we can dedup directly on the stored name. Because we walk nodes in priority
     * order (m_nodes[0] = highest), the FIRST node we see a path in is the winner.
     * This is exactly resolveChain() done once over the mount — O(total entries).
     *
     * Perf fix (#2): use string_view keys in the dedup map (no heap alloc per entry);
     * use namePtr() instead of nameAt() to avoid thread_local copy overhead;
     * reserve() the result vector and map up-front to avoid rehashing.
     *
     * Source: OUR design — REPLACES the renderer's broken JS index-juggling
     * (01-02-PLAN.md). Does NOT touch the file-ordered mountArchive() state.
     * Perf: tre-mount-perf-marshalling.md issue #2 (2026-06-24).
     */
    // Pre-count total entries for reserve() — avoids repeated rehash/realloc
    size_t totalEntries = 0;
    for (const auto& node : m_nodes)
        totalEntries += static_cast<size_t>(node.archive->entryCount());

    // Key on string_view into the archive's name block (zero heap alloc per entry).
    // The string_view is stable because TreArchive's name block is owned by the
    // archive and outlives this call.
    struct SvHash {
        size_t operator()(std::string_view sv) const noexcept {
            // FNV-1a — fast, no dependencies
            size_t h = 14695981039346656037ull;
            for (unsigned char c : sv) {
                h ^= c;
                h *= 1099511628211ull;
            }
            return h;
        }
    };
    std::unordered_map<std::string_view, size_t, SvHash> indexByPath;
    indexByPath.reserve(totalEntries);

    std::vector<TreMountVfsEntry> entries;
    entries.reserve(totalEntries); // upper bound; actual deduplicated count will be smaller

    for (int ai = 0; ai < static_cast<int>(m_nodes.size()); ++ai) {
        const TreMountNode& node = m_nodes[ai];
        const auto& nodeEntries = node.archive->entries();

        for (int ei = 0; ei < static_cast<int>(nodeEntries.size()); ++ei) {
            // Use namePtr() — zero-copy pointer into the name block (perf fix #2)
            const char* np = node.archive->namePtr(nodeEntries[ei].fileNameOffset);
            if (!np || np[0] == '\0') continue;

            const std::string_view sv(np);
            const bool isTombstone = (nodeEntries[ei].length == 0);

            auto it = indexByPath.find(sv);
            if (it == indexByPath.end()) {
                // First (highest-priority) archive containing this path → winner.
                // We must copy the name into the VfsEntry (the string_view is only
                // valid while the archive is alive, but VfsEntry owns its path string).
                TreMountVfsEntry e;
                e.path               = std::string(sv);
                e.winnerArchivePath  = node.path;
                e.winnerArchiveIndex = ai;
                e.shadowCount        = 0;
                e.isOverride         = false;
                e.isTombstone        = isTombstone;
                indexByPath.emplace(std::string_view(e.path), entries.size()); // point into the owned copy
                entries.push_back(std::move(e));
            } else {
                // Lower-priority archive also contains this path → a shadow.
                TreMountVfsEntry& winner = entries[it->second];
                winner.shadowCount += 1;
                winner.isOverride   = true;
            }
        }
    }

    // Sort by path (use indices to avoid moving string data)
    std::sort(entries.begin(), entries.end(),
              [](const TreMountVfsEntry& a, const TreMountVfsEntry& b) {
                  return a.path < b.path;
              });

    return entries;
}

// ─── vfsEntriesColumnar ──────────────────────────────────────────────────────

TreMountColumnar TreMount::vfsEntriesColumnar() const
{
    /**
     * Build the deduplicated VFS as a compact binary columnar blob.
     *
     * Algorithm: same dedup logic as vfsEntries() but writes directly into a
     * contiguous binary buffer — no per-entry Napi::Object, no N-API calls here.
     * The blob is passed to the main thread as ONE Napi::ArrayBuffer (one memcpy),
     * eliminating ~1.5M Napi::Set() calls that caused the ~1-minute freeze.
     *
     * Binary layout (little-endian):
     *   Header (32 bytes):
     *     [0]  uint32 entryCount
     *     [4]  uint32 nameDataOffset
     *     [8]  uint32 nameDataSize
     *     [12] uint32 archPathDataOffset
     *     [16] uint32 archPathDataSize
     *     [20] uint32 arrayOffset         (= 32, after header)
     *     [24] uint32[2] reserved = 0
     *
     *   Per-entry arrays at arrayOffset, each entryCount elements:
     *     uint32 nameOffsets[n]          byte offset within nameData
     *     uint32 archPathOffsets[n]      byte offset within archPathData
     *     int32  winnerArchiveIndices[n]
     *     int32  shadowCounts[n]
     *     uint8  flags[n]  (bit0=isOverride, bit1=isTombstone)
     *     [3 pad bytes to reach 4-byte alignment]
     *
     *   nameData:     all entry names, null-terminated, packed in VFS sort order
     *   archPathData: all winning archive paths, null-terminated, packed
     *
     * Perf: tre-mount-perf-marshalling.md issues #1 and #2 (2026-06-24).
     * Source: OUR design. Called inside Napi::AsyncWorker::Execute() — off main thread.
     */

    // ── Phase 1: dedup + collect, same as vfsEntries() but cheaper ──────────
    struct SvHash {
        size_t operator()(std::string_view sv) const noexcept {
            size_t h = 14695981039346656037ull;
            for (unsigned char c : sv) { h ^= c; h *= 1099511628211ull; }
            return h;
        }
    };

    size_t totalEntries = 0;
    for (const auto& node : m_nodes)
        totalEntries += static_cast<size_t>(node.archive->entryCount());

    // Intermediate storage: parallel arrays (avoids struct-of-vecs overhead)
    std::vector<const char*> namePointers;    // ptrs into archive name blocks (stable)
    std::vector<const char*> archPaths;       // winning archive paths
    std::vector<int32_t>     winnerIndices;
    std::vector<int32_t>     shadowCounts;
    std::vector<uint8_t>     flags;           // bit0=isOverride, bit1=isTombstone

    namePointers.reserve(totalEntries);
    archPaths.reserve(totalEntries);
    winnerIndices.reserve(totalEntries);
    shadowCounts.reserve(totalEntries);
    flags.reserve(totalEntries);

    // Map from name pointer (into archive name block) to result index.
    // Key is string_view to avoid any heap allocation per entry during dedup.
    std::unordered_map<std::string_view, size_t, SvHash> indexByPath;
    indexByPath.reserve(totalEntries);

    for (int ai = 0; ai < static_cast<int>(m_nodes.size()); ++ai) {
        const TreMountNode& node = m_nodes[ai];
        const auto& nodeEntries = node.archive->entries();

        for (const auto& te : nodeEntries) {
            const char* np = node.archive->namePtr(te.fileNameOffset);
            if (!np || np[0] == '\0') continue;

            const std::string_view sv(np);
            const bool isTombstone = (te.length == 0);

            auto it = indexByPath.find(sv);
            if (it == indexByPath.end()) {
                const size_t idx = namePointers.size();
                indexByPath.emplace(sv, idx);
                namePointers.push_back(np);
                archPaths.push_back(node.path.c_str());
                winnerIndices.push_back(static_cast<int32_t>(ai));
                shadowCounts.push_back(0);
                flags.push_back(isTombstone ? 0x02u : 0x00u);
            } else {
                const size_t idx = it->second;
                shadowCounts[idx] += 1;
                flags[idx] |= 0x01u; // isOverride
            }
        }
    }

    const uint32_t n = static_cast<uint32_t>(namePointers.size());

    // ── Phase 2: sort by name (sort indices, not the arrays) ─────────────────
    std::vector<uint32_t> order(n);
    for (uint32_t i = 0; i < n; ++i) order[i] = i;
    std::sort(order.begin(), order.end(), [&](uint32_t a, uint32_t b) {
        return std::string_view(namePointers[a]) < std::string_view(namePointers[b]);
    });

    // ── Phase 3: build name blobs ─────────────────────────────────────────────
    // Interleaved scan to compute sizes first (avoid realloc)
    size_t nameDataSize = 0;
    size_t archPathDataSize = 0;
    for (uint32_t i = 0; i < n; ++i) {
        nameDataSize     += std::string_view(namePointers[i]).size() + 1; // +1 for '\0'
        archPathDataSize += std::string_view(archPaths[i]).size() + 1;
    }

    // ── Phase 4: compute section offsets ─────────────────────────────────────
    constexpr uint32_t kHeaderSize  = 32;
    const uint32_t arrayOffset      = kHeaderSize;                       // arrays start here
    const uint32_t perEntryBytes    = n * (4 + 4 + 4 + 4 + 1);         // nameOff+archOff+winnerIdx+shadowCnt+flags
    const uint32_t flagPad          = (4 - (n % 4)) % 4;               // align after uint8 flags[]
    const uint32_t nameDataOffset   = arrayOffset + perEntryBytes + flagPad;
    const uint32_t archPathOffset   = static_cast<uint32_t>(nameDataOffset + nameDataSize);
    const uint32_t totalSize        = static_cast<uint32_t>(archPathOffset + archPathDataSize);

    // ── Phase 5: allocate and fill the blob ──────────────────────────────────
    TreMountColumnar col;
    col.entryCount = n;
    col.blob.resize(totalSize, 0);
    uint8_t* B = col.blob.data();

    // Helper: write LE uint32
    auto wU32 = [&](uint32_t off, uint32_t v) {
        B[off]   = static_cast<uint8_t>(v);
        B[off+1] = static_cast<uint8_t>(v >> 8);
        B[off+2] = static_cast<uint8_t>(v >> 16);
        B[off+3] = static_cast<uint8_t>(v >> 24);
    };
    // Helper: write LE int32
    auto wI32 = [&](uint32_t off, int32_t v) {
        wU32(off, static_cast<uint32_t>(v));
    };

    // Header
    wU32(0,  n);
    wU32(4,  nameDataOffset);
    wU32(8,  static_cast<uint32_t>(nameDataSize));
    wU32(12, archPathOffset);
    wU32(16, static_cast<uint32_t>(archPathDataSize));
    wU32(20, arrayOffset);
    wU32(24, 0); // reserved
    wU32(28, 0); // reserved

    // Per-entry arrays (in sorted order)
    const uint32_t nameOffBase    = arrayOffset;
    const uint32_t archOffBase    = nameOffBase    + n * 4;
    const uint32_t winnerBase     = archOffBase    + n * 4;
    const uint32_t shadowBase     = winnerBase     + n * 4;
    const uint32_t flagsBase      = shadowBase     + n * 4;

    uint32_t nameDataCursor = 0;
    uint32_t archDataCursor = 0;
    uint8_t* nameDataPtr  = B + nameDataOffset;
    uint8_t* archDataPtr  = B + archPathOffset;

    for (uint32_t si = 0; si < n; ++si) {
        const uint32_t oi = order[si]; // original index

        // Name
        const char* nm = namePointers[oi];
        const size_t nmLen = std::strlen(nm);
        wU32(nameOffBase + si * 4, nameDataCursor);
        std::memcpy(nameDataPtr + nameDataCursor, nm, nmLen + 1);
        nameDataCursor += static_cast<uint32_t>(nmLen + 1);

        // Archive path
        const char* ap = archPaths[oi];
        const size_t apLen = std::strlen(ap);
        wU32(archOffBase + si * 4, archDataCursor);
        std::memcpy(archDataPtr + archDataCursor, ap, apLen + 1);
        archDataCursor += static_cast<uint32_t>(apLen + 1);

        // winnerArchiveIndex
        wI32(winnerBase + si * 4, winnerIndices[oi]);

        // shadowCount
        wI32(shadowBase + si * 4, shadowCounts[oi]);

        // flags
        B[flagsBase + si] = flags[oi];
    }

    return col;
}

} // namespace swg
