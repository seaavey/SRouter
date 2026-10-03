//! The provider driver contract.
//!
//! A driver owns one upstream protocol: how it authenticates, how a model id
//! maps onto its catalog, and how a chat request is turned into a response or a
//! stream of SSE bytes. The registry stores drivers as trait objects, so adding
//! a provider means implementing this trait in its own module and registering
//! one constructor, with no dispatch match to extend.
//!
//! The async methods return boxed futures rather than using `async fn` in the
//! trait, because native `async fn` is not dyn-compatible and the registry
//! needs `dyn ProviderExecutor`. One boxed future per upstream call is noise
//! next to the network round trip it wraps.

use std::any::Any;

pub use futures_util::future::BoxFuture;
use serde_json::Value;

use crate::error::APIError;
use crate::features::gateway::model::ChatCompletionRequest;
use crate::features::providers::adapter::ProviderStream;

pub trait ProviderExecutor: Send + Sync {
    /// Lets the registry recover a concrete driver (for its endpoint accessors)
    /// from a trait object. Every implementation is the same one-liner.
    fn as_any(&self) -> &dyn Any;

    /// The provider's registered base id.
    fn id(&self) -> &'static str;

    /// Registry lookup keys: the base id plus any alias.
    fn keys(&self) -> &'static [&'static str];

    /// The user-facing model prefix, mirroring Node's `providerAliasFor`.
    fn alias(&self) -> &'static str;

    /// The model ids this driver advertises. Ids rather than static
    /// `ModelDefinition`s because a catalog can change at runtime (Qoder reads
    /// its list from upstream).
    fn models(&self) -> Vec<String>;

    /// Every bare id this driver advertises for the model `model` names. Only a
    /// catalog read from upstream carries several names for one model; a fixed
    /// list answers with the id it was asked about.
    fn model_id_variants(&self, model: &str) -> Vec<String> {
        vec![model.trim().to_lowercase()]
    }

    /// Refreshes a time-varying catalog when stale, or unconditionally when
    /// `force` is set. A driver with a fixed list does nothing.
    fn maybe_refresh(&self, _force: bool) -> BoxFuture<'_, ()> {
        Box::pin(async {})
    }

    /// A buffered inference request, returning the upstream JSON body unchanged
    /// the way the Node gateway passes provider responses on.
    fn chat_completion<'a>(
        &'a self,
        model: &'a str,
        request: &'a ChatCompletionRequest,
    ) -> BoxFuture<'a, Result<Value, APIError>>;

    /// A streaming inference request. The upstream call happens inside the
    /// returned future so the caller can open the SSE response first; transport
    /// failures are reported as `Err` before any byte flows.
    fn chat_completion_stream<'a>(
        &'a self,
        model: &'a str,
        request: &'a ChatCompletionRequest,
    ) -> BoxFuture<'a, Result<ProviderStream, APIError>>;
}
