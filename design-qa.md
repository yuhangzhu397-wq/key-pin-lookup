# Key 归属与凭证查询 — Design QA

- source visual truth: `/Users/zhuyuhang.39/.codex/generated_images/019f69ea-edf2-77f3-95ae-837b2b280663/exec-4302ed10-dfb7-4364-b113-c61d1d20280d.png`
- implementation screenshot: `/tmp/joymaas-key-lookup-success.png`
- combined comparison: `/tmp/joymaas-key-lookup-comparison.png`
- viewport: 1440 × 1024 CSS px, desktop
- source pixels: 1487 × 1058; normalized to 1440 × 1024 with contain/white background
- implementation pixels: 1440 × 1024, device density 1
- state: unique database match; complete API Key masked; reveal and copy controls available

## Full-view comparison evidence

The combined comparison places the selected two-pane visual on the left and the browser-rendered implementation on the right. Both use the same dark navigation, light page surface, approximately 38/62 query-detail split, inline unique-match state, prominent PIN, structured metadata rows, and a separated sensitive credential area. The implementation is slightly denser to fit the existing product header and available database fields; this is an intentional product constraint rather than a hierarchy change.

## Focused region comparison evidence

The query controls and sensitive credential region are readable in the full-size combined image, so no additional crop was needed. The implementation preserves the reference's input/button hierarchy, masked monospace credential, reveal/copy actions, green success treatment, blue security notice, restrained dividers, and lack of nested cards.

## Required fidelity surfaces

- Fonts and typography: passed. Existing Inter/PingFang stack retained; headings, 14–15px controls, 11–13px metadata, and monospace credential follow the selected hierarchy.
- Spacing and layout rhythm: passed. Two-pane alignment, shared surface, 32–34px pane padding, 54px metadata rows, and compact credential controls match the reference intent without clipping.
- Colors and visual tokens: passed. Existing navy header, purple primary action, pale green success, pale blue security notice, and neutral gray dividers are preserved.
- Image and icon fidelity: passed. Existing brand logo asset retained; interface icons use the installed Phosphor icon library rather than handcrafted assets.
- Copy and content: passed. The page explains Key ID/full Key/first-seven input, collision handling, unique-match status, full Key sensitivity, and 30-second auto-hide behavior.

## Interaction and runtime evidence

- Page identity: `http://127.0.0.1:8090/`, title `Key 归属查询`.
- Real Key ID query returned a unique database record with PIN, Key ID, application, and masked full API Key.
- Seven-character API Key prefix was tested for both ambiguous and unique outcomes.
- Reveal control exposed the complete Key only after explicit action and automatically returned to the masked state after 30 seconds.
- Copy action reached the `已复制` state without exposing clipboard contents in logs.
- Browser console warnings/errors: none.

## Comparison history

1. Initial browser capture showed the empty result state, which did not match the selected success-state source. No visual judgment was made from that state.
2. A real unique-match query was executed and recaptured at 1440 × 1024. Side-by-side comparison found no actionable P0/P1/P2 mismatch.

## Findings

No actionable P0/P1/P2 findings remain. The implementation intentionally omits creation/update timestamps from the concept because the current lookup table contract does not guarantee those fields and the requested outcome does not require them.

## Follow-up polish

- P3: If the database schema later provides stable created/updated timestamps, they can be added as optional detail rows without changing the layout.

final result: passed
