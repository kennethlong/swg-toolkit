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

namespace swg {

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
            // Get the entry name (already normalized: lowercase, forward-slash)
            const char* namePtr = nullptr;
            try {
                namePtr = node.archive->nameAt(entries[ei].fileNameOffset).c_str();
            } catch (...) {
                continue; // defensive — skip corrupt name block entries
            }
            if (!namePtr || namePtr[0] == '\0') continue;

            // Name is already lowercase (normalized by TreArchive)
            const std::string entryName(namePtr);

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

} // namespace swg
