# Playground & Streaming UI

The playground is the highest-interaction area of the dashboard.

## Responsibilities

- streaming chat UX
- provider/model selection
- prompt experimentation
- tool-call visualization
- markdown/code rendering
- request debugging

## Streaming Rules

- tolerate incremental SSE chunks
- never assume complete payload ordering
- handle interrupted streams gracefully
- preserve partial output during failures
- avoid blocking UI during active streams

## Rendering

Prefer:

- incremental rendering
- lightweight memoization
- reusable message primitives

Avoid:

- rerendering the entire transcript per token
- expensive syntax highlighting loops
- duplicated markdown rendering pipelines

## Error Handling

Streaming failures should:

- preserve prior messages
- surface concise actionable errors
- allow retry without page refresh
- reset only affected state
