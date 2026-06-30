# fixtures-real/toc/

Real SearchTOC fixtures for MOUNT-03 and related byte-exact tests.

## Files

### sku0_client_header.bin (pre-existing)

Header-only fixture from the real `sku0_client.toc` (36-byte header + tree-name block = 2793 bytes).
Used by `tocReader.test.ts` for header-parse CI gate. Full archive is gitignored (D-10).

### appearance_lod_thm_must_droid_factory_exterior.lod.v6000.\* (Plan 04.3-03)

A deliberately extracted small payload from the SWG-Source v6000 plain-zlib container set.

| File | Contents | Size |
|------|----------|------|
| `*.v6000.zlib.bin`       | Raw compressed bytes as stored in the .tre (compressor=2, zlib) | 564 bytes |
| `*.v6000.expected.bin`   | zlib-inflated result — the ground-truth oracle payload | 1092 bytes |
| `*.v6000.descriptor.json`| Entry metadata (container, offset, length, compressedLength, compressor, crc) | — |

**Source:** `D:/Code/SWGSource Client v3.0/`
  - Master TOC: `sku3_client.toc` (1,158 entries)
  - Container: `patch_sku3_24_client_00.tre` (EERT6000, numberOfFiles=0, plain-zlib payload)
  - Virtual path: `appearance/lod/thm_must_droid_factory_exterior.lod`
  - Offset in container: 26174, compressedLength: 564, length: 1092, crc: 0x058f215e

**Regenerate command:**
```
node packages/harness/scripts/extract-v6000-fixture.mjs
```
Re-running on the same client produces byte-identical output (same entry chosen, same bytes).

## De-anchoring Note (CRITICAL — v6000 dual-format)

v6000 is a **dual format** — do NOT conflate the two variants:

| Variant | Archives | Payload |
|---------|----------|---------|
| SWG-Source / swg-client-v2 | `patch_sku3_*.tre` | **PLAIN ZLIB** (`78 9c` magic at offset 36) |
| Restoration | `SwgRestoration_*.tre` | **ENCRYPTED** (decryption key required) |

The `restoration-SwgRestoration_*.tre` files in `fixtures-real/` are the ENCRYPTED variant.
The `.v6000.zlib.bin` fixture here is the **PLAIN-ZLIB** variant from SWG-Source Client v3.0.

Ground-truth oracle: `../swg-blender-plugin/swg_pipeline/tre_reader.py::read_tre_payload`

## Asset Safety (D-09/D-10)

These `.bin` and `.json` files are a **per-plan exception** to the gitignored `.tre` policy:
- They contain ONE small deliberately-extracted payload (564 + 1092 bytes), not a full archive.
- The parent `.gitignore` ignores `*.tre`/`*.TRE` only; `.bin` and `.json` are tracked.
- Full archives (`patch_sku3_*.tre`) remain gitignored and are never committed.
