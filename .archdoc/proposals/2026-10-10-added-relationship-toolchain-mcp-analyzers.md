# Proposal: Added relationship toolchain.mcp → analyzers

Proposed by agent:claude-code on 2026-10-10. The additions are marked `provenance: { source: suggested }` until a person accepts them (by removing the provenance block) or rejects them (by deleting them).

## Why

Phase 3b adds archdoc_check to the MCP server. It runs the same analysis as the CLI through checkRepository in @archdoc/analyzers, because MCP may not call the CLI (rule cli-is-the-front-door).

## Changes

- Added relationship toolchain.mcp → analyzers.
