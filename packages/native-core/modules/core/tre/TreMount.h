/**
 * TreMount.h — Priority-based TRE virtual filesystem mount resolver.
 *
 * Implements the search-node priority list and first-match-wins shadow resolution
 * from the real SWG client, extended with our resolveChain algorithm.
 *
 * Ported from:
 *   swg-client-v2 TreeFile.cpp:285-308  (searchNodePriorityOrder + addSearchNode with
 *                                         std::lower_bound + strict priority> predicate)
 *   swg-client-v2 TreeFile.cpp:437-461  (find(): first-match-wins traverse over sorted list)
 *   swg-client-v2 TreeFile.cpp:511-601  (fixUpFileName: lowercase, backslash->/, strip leading ./../)
 *
 * Same-priority tie-break (code-vs-comment ambiguity settled by test):
 *   The client code at TreeFile.cpp:294-296 comments that equal-priority nodes insert
 *   AFTER the last match, but the code (std::lower_bound with strict predicate `a > b`)
 *   actually returns the FIRST position where the predicate is false (i.e., where
 *   existing.priority <= new.priority), which for equal priorities is the FIRST element
 *   in the equal-priority run. This inserts the NEW node BEFORE the existing same-priority
 *   nodes — so the MOST RECENTLY MOUNTED equal-priority archive wins.
 *   The tre-priority-tie-break test pins this exact behavior.
 *
 * resolveChain (OUR algorithm — the client does not report the shadow chain):
 *   Walk the priority list, collecting every archive containing `name`. The WINNER
 *   is the first archive encountered (highest priority). If the winner's entry is a
 *   tombstone (length==0), set tombstone=true and represent the winner as the deleting
 *   archive. Invariant: for the non-tombstone case, resolveChain(name).winner == resolve(name).
 *
 * Search (OUR design — CORE-02):
 *   Case-insensitive substring over the flat name list of all mounted archives (merged).
 *   Optional glob mode supports * (any chars) and ? (single char).
 *   Returns matched INDICES — never the full name list (T-01-06 mitigation).
 */

#pragma once

#include "TreArchive.h"
#include <string>
#include <vector>
#include <memory>
#include <cstdint>

namespace swg {

/** One archive + its priority in the mount list. */
struct TreMountNode {
    std::unique_ptr<TreArchive> archive;
    std::string                 path;     ///< Filesystem path to the .tre file
    int                         priority; ///< Mount priority (higher = higher precedence)
};

/**
 * Result of resolving a single path against the virtual mount.
 *
 * For non-tombstone wins: winner == the archive path, tombstone == false,
 *   archiveIndex / entryIndex valid for payload extraction.
 * For tombstone wins: tombstone == true, winner == the deleting archive's path,
 *   archiveIndex points to the tombstone archive.
 * Not found: winner == "", archiveIndex == -1.
 */
struct TreMountResolveResult {
    std::string winner;       ///< Path of the winning archive (or "" if not found)
    bool        tombstone;    ///< True if the winner entry is a tombstone (file deleted)
    int         archiveIndex; ///< Index in the mount list (or -1 if not found)
    int         entryIndex;   ///< TOC entry index in the winning archive (or -1)
};

/**
 * One entry in a shadow chain.
 * Source: Our algorithm — the client does not report shadow chains.
 */
struct TreShadowChainEntry {
    std::string archivePath;
    bool        isTombstone;
    int         archiveIndex;
    int         entryIndex;
};

/**
 * The full shadow chain for a resolved path.
 * winner is the first (highest-priority) entry; shadows are lower-priority entries.
 */
struct TreShadowChain {
    std::string                        winner;      ///< Winning archive path
    std::vector<std::string>           shadows;     ///< Lower-priority archive paths (highest first)
    bool                               tombstone;   ///< True if winner is a tombstone
    int                                winnerArchiveIndex;
    int                                winnerEntryIndex;
};

/**
 * One search hit: entry index + archive index in the mount list.
 * Source: RESEARCH.md § "TRE Search Semantics"; T-01-06 disposition.
 */
struct TreSearchHitNative {
    int entryIndex;
    int archiveIndex;
};

/**
 * Per-archive metadata for the mount, in the SAME priority-sorted index space as
 * search()/resolve()/resolveChain() (archiveIndex = position in the node list).
 *
 * Source: OUR design — exposes TreArchive::version() / isEnumerateOnly() to the UI
 * in the mount-handle index space (the fix for the index-space mismatch in
 * 01-02-PLAN.md: the renderer must NOT join against mountArchive()'s file-ordered state).
 */
struct TreMountArchiveInfo {
    std::string path;
    std::string version;        ///< Version string: "v0004"/"v0005"/"v0006"/"v5000"/"v6000"
    bool        enumerateOnly;  ///< True only for v6000 (encrypted, payloads not extractable)
    int         entryCount;
    int         priority;
    int         archiveIndex;   ///< Position in the priority-sorted node list
};

/**
 * One deduplicated, shadow-resolved VFS entry for the whole mount.
 *
 * winnerArchiveIndex is in the SAME priority space as TreMountArchiveInfo::archiveIndex,
 * so the UI can join the two. isOverride == (shadowCount > 0).
 *
 * Source: OUR design — resolveChain logic done once over the mount (01-02-PLAN.md).
 */
struct TreMountVfsEntry {
    std::string path;               ///< Normalized path (lowercase, forward-slash)
    std::string winnerArchivePath;  ///< Path of the winning (highest-priority) archive
    int         winnerArchiveIndex; ///< Priority-list index of the winner
    int         shadowCount;        ///< Number of lower-priority archives also containing the path
    bool        isOverride;         ///< shadowCount > 0
    bool        isTombstone;        ///< True if the winner entry is a tombstone
};

/**
 * Zero-copy columnar VFS payload — ONE binary blob that encodes all VFS entries.
 *
 * Binary layout (all little-endian):
 *
 *   Header (32 bytes):
 *     [0]   uint32 entryCount
 *     [4]   uint32 nameDataOffset      — byte offset from blob start to nameData
 *     [8]   uint32 nameDataSize        — total byte length of nameData section
 *     [12]  uint32 archPathDataOffset  — byte offset from blob start to archPathData
 *     [16]  uint32 archPathDataSize
 *     [20]  uint32 arrayOffset         — byte offset from blob start to per-entry arrays
 *     [24]  uint32 reserved[2]         — zero
 *
 *   Per-entry arrays (each entryCount elements, packed immediately after arrayOffset):
 *     nameOffsets[n]         — uint32: byte offset within nameData for entry n's name
 *     archPathOffsets[n]     — uint32: byte offset within archPathData for winner path
 *     winnerArchiveIndices[n]— int32:  priority-list index of winning archive
 *     shadowCounts[n]        — int32:  number of shadowed lower-priority archives
 *     flags[n]               — uint8:  bit0=isOverride, bit1=isTombstone
 *     [pad to 4-byte alignment]
 *
 *   nameData:       all entry names packed as null-terminated UTF-8, in VFS sort order
 *   archPathData:   all winning archive paths packed as null-terminated UTF-8
 *
 * The renderer decodes names lazily: only visible/requested rows need a string decode.
 * Crossing the N-API bridge costs ONE ArrayBuffer instead of ~1.5M Napi::Set() calls.
 *
 * Source: perf fix for the ~250k-entry main-thread marshalling freeze (2026-06-24).
 */
struct TreMountColumnar {
    std::vector<uint8_t> blob; ///< Complete binary payload (see layout above)
    uint32_t             entryCount = 0;
};

/**
 * TreMount — priority-ordered list of mounted TRE archives.
 *
 * Ported from swg-client-v2 TreeFile.cpp:285-308 (priority list management)
 * and TreeFile.cpp:437-461 (first-match-wins traverse).
 *
 * Usage:
 *   TreMount mount;
 *   mount.addArchive(std::move(arc), "/path/to/foo.tre", 2);
 *   mount.addArchive(std::move(arc2), "/path/to/bar.tre", 1);
 *   TreMountResolveResult r = mount.resolve("appearance/foo.apt");
 */
class TreMount {
public:
    TreMount() = default;
    TreMount(TreMount&&) = default;
    TreMount& operator=(TreMount&&) = default;
    TreMount(const TreMount&) = delete;
    TreMount& operator=(const TreMount&) = delete;

    /**
     * Add a parsed archive at the given priority.
     *
     * Insertion uses std::lower_bound with the strict `a.priority > b.priority` predicate,
     * mirroring the real client exactly. For equal priorities this inserts the new archive
     * BEFORE existing same-priority archives (see header comment for the code-vs-comment
     * analysis). The tie-break test pins this exact behavior.
     *
     * Source: swg-client-v2 TreeFile.cpp:285-308 (searchNodePriorityOrder + addSearchNode).
     *
     * @param archive   Parsed TreArchive (ownership transferred).
     * @param path      Filesystem path to the archive (used as the archive identifier).
     * @param priority  Mount priority (higher = higher precedence).
     */
    void addArchive(std::unique_ptr<TreArchive> archive, std::string path, int priority);

    /**
     * Resolve a path to the highest-priority archive that contains it.
     *
     * Runs fixUpFileName on `rawName`, then walks the priority list calling
     * TreArchive::resolve() on each. Returns the first match (tombstone or real).
     *
     * Source: swg-client-v2 TreeFile.cpp:437-461 (find()); TreeFile.cpp:511-601 (fixUpFileName).
     *
     * @param rawName  Unnormalized path (any slash style, leading ./ etc.).
     * @returns        TreMountResolveResult with winner/tombstone/indices.
     */
    TreMountResolveResult resolve(const std::string& rawName) const;

    /**
     * Build the full shadow chain for a path.
     *
     * OUR algorithm (the client stops at the first tombstone and does not report the chain):
     * Walk the ENTIRE priority list, collecting every archive that contains `name` (real
     * entry or tombstone). The winner is the first one (highest priority). Lower-priority
     * entries appear in `shadows` in highest-first order.
     *
     * Invariant (tested): resolveChain(name).winner == resolve(name).winner
     *   for the non-tombstone case.
     *
     * @param rawName  Unnormalized path.
     * @returns        TreShadowChain with winner + shadows + tombstone flag.
     */
    TreShadowChain resolveChain(const std::string& rawName) const;

    /**
     * Search mounted archives for entries whose path matches the query.
     *
     * Mode 'substring': case-insensitive substring match (default).
     * Mode 'glob': * = any chars, ? = single char (case-insensitive).
     *
     * Returns matched INDICES, never the name list itself (T-01-06: do not ship
     * the full name list to JS per keystroke — archives hold 100k+ entries).
     *
     * Source: RESEARCH.md § "TRE Search Semantics"; T-01-06 threat mitigation.
     *
     * @param text  Search text (case-insensitive).
     * @param glob  True = glob mode, false = substring mode (default).
     * @returns     Vector of { entryIndex, archiveIndex } hits.
     */
    std::vector<TreSearchHitNative> search(const std::string& text, bool glob) const;

    /**
     * Per-archive metadata in priority-sorted index space (archiveIndex matches
     * search()/resolve() hits). One entry per mounted archive, highest-priority first.
     *
     * Source: OUR design — exposes version/enumerateOnly to the UI in the mount handle
     * index space (01-02-PLAN.md index-space-mismatch fix).
     */
    std::vector<TreMountArchiveInfo> archiveInfos() const;

    /**
     * The deduplicated, shadow-resolved VFS for the whole mount.
     *
     * For every unique normalized path across all archives, compute the winner
     * (first match in priority order) + how many lower-priority archives also contain
     * it (shadowCount) + tombstone. This is resolveChain logic done once in C++,
     * O(total entries). Returned sorted by path.
     *
     * Source: OUR design — REPLACES the renderer's broken JS index-juggling
     * (01-02-PLAN.md). Does NOT depend on the file-ordered mountArchive() state.
     */
    std::vector<TreMountVfsEntry> vfsEntries() const;

    /**
     * Build the deduplicated VFS as a zero-copy columnar binary blob.
     *
     * Same algorithm as vfsEntries() but serializes the result directly into a
     * compact binary payload (see TreMountColumnar for the layout). The renderer
     * receives ONE ArrayBuffer instead of ~250k Napi::Object instances — eliminating
     * the main-thread N-API bridge overhead that caused the one-minute freeze.
     *
     * This is intended to be called from INSIDE a Napi::AsyncWorker::Execute()
     * (off the main thread). The result is then cached on the mount handle; the
     * main thread retrieves it via getMountEntriesColumnar() as a single memcpy.
     *
     * Source: perf fix — issue #1 in tre-mount-perf-marshalling.md (2026-06-24).
     */
    TreMountColumnar vfsEntriesColumnar() const;

    /** Number of mounted archives. */
    int archiveCount() const { return static_cast<int>(m_nodes.size()); }

    /** Access the archive node at the given (priority-list) index. */
    const TreMountNode& nodeAt(int idx) const { return m_nodes[idx]; }

    /**
     * Store a pre-built columnar payload (built off-thread inside AsyncWorker::Execute).
     * Thread-safety: written once by the worker before OnOK() runs; after that it is
     * read-only on the main thread. No mutex needed.
     */
    void setCachedColumnar(TreMountColumnar col) { m_cachedColumnar = std::move(col); }

    /**
     * Retrieve the cached columnar payload.
     * Returns a reference valid for the lifetime of this TreMount.
     */
    const TreMountColumnar& cachedColumnar() const { return m_cachedColumnar; }

    /** True if a cached columnar payload has been built and stored. */
    bool hasColumnar() const { return !m_cachedColumnar.blob.empty(); }

private:
    /**
     * Normalize a file path: lowercase, backslash->forward slash, collapse repeated
     * slashes, strip leading ./ and ../.
     *
     * Ported from swg-client-v2 TreeFile.cpp:511-601 (fixUpFileName).
     */
    static std::string fixUpFileName(const std::string& rawName);

    /** Glob match: case-insensitive. * = any sequence, ? = single char. */
    static bool globMatch(const std::string& pattern, const std::string& text);

    /**
     * Priority-sorted archive list (highest priority first).
     * Invariant: m_nodes[i].priority >= m_nodes[i+1].priority for all i.
     */
    std::vector<TreMountNode> m_nodes;

    /**
     * Cached columnar VFS payload — built off-thread, served on the main thread.
     * Empty until setCachedColumnar() is called (i.e., after mountSearchableAsync).
     */
    TreMountColumnar m_cachedColumnar;
};

} // namespace swg
