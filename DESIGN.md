# Launcher

The launcher keeps the dock's floating, frosted appearance and five columns at its normal width. Columns adapt when zoomed or narrowed, and vertical arrow navigation follows the rendered columns. App names have two reserved lines at 12px rather than a single truncated line, with fixed icon and label heights so delayed icons and search results do not shift the grid.

Search stays above the scrolling results. The search icon and persistent Enter / Ctrl+Enter shortcuts make searching, opening, and pinning discoverable without putting instructions in the placeholder. The selected app has an accent-tinted surface and outline, distinct from hover; keyboard focus has a stronger outline. Full names remain available through accessible names and native tooltips.

Colors inherit the existing six themes and glass/opaque surface tokens. The launcher uses `--launcher-gap` for repeated spacing and `--launcher-focus` for its focus and selection color. Motion follows the existing panel entrance and reduced-motion rules. No dock geometry, widget input behavior, or cursor behavior is changed.
