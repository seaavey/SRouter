# SRouter documentation design direction

## Design Read

Reading this as a source-oriented documentation portal for developers operating and extending a local AI gateway, using the same visual system as `apps/web`.

## Identity

SRouter docs use the `apps/web` monochrome canvas system: white or near-black canvas, soft grey surfaces, thin hairlines, ink typography, and a blue action accent. The visual voice comes from the gateway's source boundaries: routes, packages, providers, commands, and request flow.

## Decisions

- Color: `--canvas`, `--canvas-soft`, `--field`, `--hairline`, `--ink`, and `--accent` mirror `apps/web/src/styles.css`.
- Typography: Inter carries documentation copy and headings. JetBrains Mono labels source paths, commands, variables, and metadata.
- Layout: a fixed desktop sidebar and sticky topbar establish the same app-shell rhythm as `apps/web`. Content stays constrained for readable source explanations.
- Overview: a short source map, documentation areas, and a four-stage request architecture replace the old marketing-only hero.
- Documentation pages: Markdown content is rendered through one `DocsLayout.astro` shell with active navigation, breadcrumbs, code blocks, tables, and source links.
- Surfaces: thin borders and rounded canvas-soft cards group navigation and source maps. No shadows or decorative gradients are introduced.
- Motion: only short theme and hover transitions are used. Reduced motion is respected.
- Theme: dark remains the default, with a functional light theme stored in local storage.
- Responsive behavior: the sidebar becomes a labeled menu below 760px; content, tables, code blocks, and cards remain readable without page-level horizontal overflow.

## Content source

Product behavior, commands, ports, providers, routes, and configuration values are transcribed from the SRouter repository README, agent guide, API route files, CLI command definitions, package entrypoints, Docker Compose file, and Dockerfile. No customer names, testimonials, performance numbers, or unsupported product claims are included.
