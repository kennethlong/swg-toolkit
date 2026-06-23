/**
 * FileInputStream.h — File-backed IInputStream implementation.
 *
 * Wraps std::ifstream for positional reads. Used by the N-API binding when
 * mounting archives from file paths (FileInputStream owns the file handle).
 *
 * Source: derived from FileStreamer::File usage in
 *   swg-client-v2 TreeFile_SearchNode.cpp:262-268 (FileStreamer::open + read)
 *
 * Thread safety: NOT thread-safe for concurrent reads (the ifstream seekg/read
 * pair is not atomic). The binding must serialize reads or use one instance per
 * thread. For the async worker path, create a new FileInputStream per worker.
 */

#pragma once

#include "IInputStream.h"
#include <fstream>
#include <string>

namespace swg {

class FileInputStream final : public IInputStream {
public:
    /**
     * Open a file for positional reading.
     *
     * @param path  Filesystem path to the .tre archive (or any binary file).
     * @throws std::runtime_error if the file cannot be opened.
     */
    explicit FileInputStream(const std::string& path)
        : m_file(path, std::ios::binary | std::ios::ate)
        , m_size(0)
    {
        if (!m_file.is_open())
            throw std::runtime_error("FileInputStream: cannot open '" + path + "'");
        m_size = static_cast<int>(m_file.tellg());
        if (m_size < 0)
            m_size = 0;
    }

    bool isOpen() const { return m_file.is_open(); }

    int read(int offset, void* dst, int len) override {
        if (!m_file.is_open() || offset < 0 || len <= 0 || offset >= m_size)
            return 0;
        m_file.seekg(static_cast<std::streamoff>(offset));
        if (!m_file)
            return 0;
        const int available = m_size - offset;
        const int toRead = (len < available) ? len : available;
        m_file.read(static_cast<char*>(dst), toRead);
        const int bytesRead = static_cast<int>(m_file.gcount());
        // Clear any eof/fail state so subsequent reads work
        m_file.clear();
        return bytesRead;
    }

    int length() const override {
        return m_size;
    }

private:
    mutable std::ifstream m_file;
    int                   m_size;
};

} // namespace swg
