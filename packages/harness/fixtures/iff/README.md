# IFF test fixtures

Synthesized IFF fixtures for CORE-03 / CORE-04 round-trip and parse tests.

All fixtures are handcrafted per the verified byte layout:
  swg-client-v2 Iff.cpp:508-555 (BE read), :637-644 (BE write, FORM innerLen + sizeof(Tag)),
  Utinni IffReader.cs:140-327, IffWriter.cs:98-187.

## Fixture inventory

| File | Description |
|------|-------------|
| `simple-nested.iff` | One FORM:DERV containing one leaf chunk — basic parse + round-trip |
| `odd-chunk-no-pad.iff` | FORM:TEST containing a leaf with odd payload length (1 byte) and NO pad byte — confirms write does not add a pad |
| `pad-present.iff` | FORM:TEST containing a leaf with odd payload length (1 byte) WITH a 0x00 pad — confirms read detects and consumes it |
| `gapped-form.iff` | FORM whose declared innerLen exceeds its children's actual span — interior gap is preserved verbatim by clean-span re-emit |
| `trailing-bytes.iff` | Valid FORM followed by extra bytes — confirmed trailing-bytes node surfaced |
| `list-container.iff` | LIST container block — confirms LIST is treated as a container |
| `cat-container.iff` | CAT  container block (trailing space) — confirms CAT  is treated as a container |

## Layout reference (verified against ground truth)

Block framing (big-endian):
  [4B tag BE][4B length BE][payload]

FORM header = 12 bytes:
  [4B 'FORM'][4B innerLen BE][4B subTypeTag BE]
  innerLen INCLUDES the 4-byte subTypeTag (Iff.cpp:643).
  Children span = innerLen - 4.

Leaf header = 8 bytes:
  [4B typeId BE][4B payloadLen BE][payload bytes]
  payloadLen = payload bytes only (excluding the 8-byte header).

NO pad byte is emitted by writer (IffWriter.cs:141).
Reader DETECTS a 0x00 pad after an odd-length leaf only when actually present (IffReader.cs:307-327).
