use axum::response::sse::Event;
use srouter_server::features::gateway::sse::{ReasoningEvent, ReasoningStreamParser, to_sse_event};

#[test]
fn test_parser_lifecycle_emits_start_delta_end() {
    let mut parser = ReasoningStreamParser::new();

    // First chunk carries the reasoning delta
    let events = parser.parse_chunk("reasoning-0", Some("Let's analyze"), false);
    assert_eq!(
        events,
        vec![
            ReasoningEvent::ReasoningStart {
                id: "reasoning-0".to_string()
            },
            ReasoningEvent::ReasoningDelta {
                id: "reasoning-0".to_string(),
                text: "Let's analyze".to_string()
            }
        ]
    );

    // 2. Second chunk continues the reasoning text
    let events = parser.parse_chunk("reasoning-0", Some(" this problem"), false);
    assert_eq!(
        events,
        vec![ReasoningEvent::ReasoningDelta {
            id: "reasoning-0".to_string(),
            text: " this problem".to_string()
        }]
    );

    // 3. Third chunk starts emitting non-reasoning content (e.g. plain text content)
    let events = parser.parse_chunk("reasoning-0", None, true);
    assert_eq!(
        events,
        vec![ReasoningEvent::ReasoningEnd {
            id: "reasoning-0".to_string()
        }]
    );
}

#[test]
fn test_parser_finish_flushes_active_block() {
    let mut parser = ReasoningStreamParser::new();

    parser.parse_chunk("reasoning-1", Some("Thinking quietly"), false);
    let end_event = parser.finish();

    assert_eq!(
        end_event,
        Some(ReasoningEvent::ReasoningEnd {
            id: "reasoning-1".to_string()
        })
    );
    assert_eq!(parser.finish(), None);
}

#[test]
fn test_to_sse_event_format() {
    let event = ReasoningEvent::ReasoningDelta {
        id: "reasoning-0".to_string(),
        text: "delta text".to_string(),
    };
    let sse: Event = to_sse_event(&event).unwrap();
    let debug_str = format!("{sse:?}");
    assert!(debug_str.contains("event: reasoning-delta"));
    assert!(debug_str.contains("delta text"));
}
