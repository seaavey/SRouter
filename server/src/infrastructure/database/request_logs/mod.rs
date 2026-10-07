//! Request-log persistence and API response mapping.
//!
//! Split into `store` (rows, event stream, insert path) and `analytics`
//! (all-time usage totals and the windowed report); the public path stays
//! `database::request_logs::*`.

mod analytics;
mod store;

pub use analytics::{
    AnalyticsBucket, AnalyticsProviderSlice, AnalyticsReport, AnalyticsTopAgent, AnalyticsTopModel,
    AnalyticsWindow, analytics_report, parse_analytics_window, usage_stats,
};
pub use store::{
    HttpMethod, LogClient, LogCost, LogError, LogTokenUsage, LogsPage, ObjectKind, RequestLog,
    RequestLogInput, generate_log_id, get_request_log, insert_request_log, list_request_logs,
    subscribe_request_logs,
};
