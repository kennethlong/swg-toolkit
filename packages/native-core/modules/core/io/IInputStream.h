/**
 * IInputStream.h — Engine-free injectable IO interface for the SWG native core lib.
 *
 * Replaces the SOE engine's FileStreamer::File interface so the TRE/IFF parsers
 * have zero dependency on FileStreamer, Os, ConfigFile, or Mutex.
 *
 * Source: derived from FileStreamer::File usage in
 *   swg-client-v2 TreeFile_SearchNode.cpp:227-330 (read call sites)
 *   swg-client-v2 TreeFile_SearchNode.cpp:268 (m_treeFile->read(offset, &header, sizeof(header), ..))
 *
 * Decision D-01: do NOT compile the SOE engine subset — port cleanly.
 * Decision D-02: standalone, engine-free, C++20, injectable IO.
 */

#pragma once

#include <cstdint>

namespace swg {

/**
 * IInputStream — abstract random-access byte stream.
 *
 * Implementations:
 *   MemoryInputStream  — wraps a const uint8_t* + size (harness / zero-copy ArrayBuffer path)
 *   FileInputStream    — wraps std::ifstream (file path mount)
 *
 * Contract:
 *   read(offset, dst, len) reads exactly `len` bytes starting at absolute byte `offset`
 *   into `dst`. Returns the number of bytes actually read (may be less than len at EOF).
 *   read() MUST NOT move an internal cursor — it is a pure positional read.
 *
 *   length() returns the total byte length of the stream.
 */
class IInputStream {
public:
    virtual ~IInputStream() = default;

    /**
     * Read `len` bytes from absolute byte offset `offset` into `dst`.
     *
     * @param offset  Absolute byte offset within the stream (0-based).
     * @param dst     Destination buffer (must be at least `len` bytes).
     * @param len     Number of bytes to read.
     * @returns       Number of bytes actually read. Returns 0 on error or EOF.
     */
    virtual int read(int offset, void* dst, int len) = 0;

    /**
     * Return the total length of the stream in bytes.
     */
    virtual int length() const = 0;

protected:
    IInputStream() = default;
    IInputStream(const IInputStream&) = delete;
    IInputStream& operator=(const IInputStream&) = delete;
};

} // namespace swg
