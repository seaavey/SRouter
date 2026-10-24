//! Request-log persistence and API response mapping.
//!
//! Split into `store` (rows, event stream, insert path) and `analytics`
//! (all-time usage totals and the windowed report); the public path stays
//! `database::request_logs::*`.

mod analytics;
mod store;

pub use analytics::{
    AnalyticsBucket, AnalyticsProviderSlice, AnalyticsReport, AnalyticsTopAgent, AnalyticsTopModel,
    AnalyticsWindow, LogsSummary, LogsTokenTotals, UsageByModel, UsageCacheTokens, UsageCostTotals,
    UsageData, UsageRequestTotals, UsageStatsReport, UsageTokenTotals, UsageTotals,
    analytics_report, logs_summary, parse_analytics_window, usage_stats,
};
pub use store::{
    HTTPMethod, LogClient, LogCost, LogError, LogFilters, LogTokenUsage, LogsPage, ObjectKind,
    RequestLog, RequestLogInput, generate_log_id, get_request_log, insert_request_log,
    list_request_logs, subscribe_request_logs,
};
