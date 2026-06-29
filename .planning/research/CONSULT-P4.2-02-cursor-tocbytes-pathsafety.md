# CONSULT P4.2-02 — Cursor — .toc byte-map + deploy path-safety

You are reviewing a PLAN for the SWG Toolkit. Verify byte-level claims against REAL source + bytes, not
the plan's assertions. Ground truth = `../swg-client-v2` source, `../swg-blender-plugin` reader, and the
real `D:\Code\SWGSource Client v3.0\sku0_client.toc` bytes.

## GIVEN (LOCKED — do NOT re-derive; verify the plan AGAINST these)
G1. `.toc` = magic `" COT1000"` (TAG "TOC"/0001). Real `sku0_client.toc`: numberOfFiles=193475,
    numberOfTreeFiles=131, sizeOfTOC=4643400. Header is 36 bytes; a tree-name block of the 131 archive
    names follows. `SearchTOC::Header` + `TableOfContentsEntry` structs at `TreeFile_SearchNode.h:270-299`.
    Blender reader: `../swg-blender-plugin/swg_pipeline/tre_reader.py:335-413`
    (`read_search_toc_header`/`read_search_toc_entries`).

## THE PLAN'S PROPOSED APPROACH (verify, don't endorse)
- `tocReader.ts` parses ONLY the header + tree-name block (no 193k index). It will check in the first
  **2793 bytes** (36 header + tree-name block) of the real `sku0_client.toc` as a CI fixture oracle and
  assert numberOfFiles=193475, numberOfTreeFiles=131, magic `" COT1000"`, names[0]=`bottom.tre`.
- `looseOverrideDeploy.deployLoose` writes staged files to `<overrideDir>/<virtualPath>` after
  `isVirtualPathSafe(virtualPath)` (pathSafety.ts) AND a second `path.resolve().startsWith(overrideDir)`
  check.

## YOUR ANGLE (byte-exactness + write-path safety)
1. **Byte layout:** From `TreeFile_SearchNode.h` struct + the blender reader, give the exact field map of
   the 36-byte header AND the tree-name block (how are the 131 names delimited/lengthed? null-terminated?
   length-prefixed? is the block self-delimiting from the header alone?). **Is 2793 bytes the correct,
   complete slice for header + tree-name block of the REAL file** — verify by reading the actual bytes of
   `D:\Code\SWGSource Client v3.0\sku0_client.toc` (first ~4KB) and locating where the tree-name block ends.
   If 2793 is wrong, give the correct byte count and how you derived it.
2. **Magic/endianness:** confirm `" COT1000"` byte order and the uint field endianness (LE?) the reader must use.
3. **Path safety:** is `isVirtualPathSafe` + `resolve().startsWith(overrideDir)` sufficient to confine
   writes? Probe bypasses: absolute virtualPath, `..`, drive-letter, UNC, symlink, trailing-dot/space on
   Windows, case-folding. Name any that slip through.

## OUTPUT
Field-level byte map with citations, a VERIFIED/WRONG verdict on the 2793-byte slice (with the corrected
number if wrong), and a list of any path-safety bypasses. Do not rewrite the plan.
