/**
 * MemoryInputStream.h — In-memory IInputStream implementation.
 *
 * Wraps a const uint8_t* + size. Used by:
 *   - The harness (feeds synthesized fixture bytes without file I/O)
 *   - The N-API binding (wraps a JS ArrayBuffer.Data() for zero-copy parse)
 *
 * Source: derived from FileStreamer::File usage in
 *   swg-client-v2 TreeFile_SearchNode.cpp:227-330
 *
 * Thread safety: immutable after construction — safe to share across threads.
 */

#pragma once

#include "IInputStream.h"
#include <algorithm>
#include <cstring>

namespace swg {

class MemoryInputStream final : public IInputStream {
public:
    /**
     * Construct from a raw byte buffer.
     *
     * @param data  Pointer to the byte data. Must outlive this object.
     * @param size  Number of bytes in `data`.
     */
    MemoryInputStream(const uint8_t* data, int size) noexcept
        : m_data(data), m_size(size) {}

    int read(int offset, void* dst, int len) override {
        if (!m_data || offset < 0 || len <= 0 || offset >= m_size)
            return 0;
        const int available = m_size - offset;
        const int toRead = std::min(len, available);
        std::memcpy(dst, m_data + offset, static_cast<size_t>(toRead));
        return toRead;
    }

    int length() const override {
        return m_size;
    }

private:
    const uint8_t* m_data;
    int            m_size;
};

} // namespace swg
