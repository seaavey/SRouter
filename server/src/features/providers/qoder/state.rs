//! Shared lock-guard helpers for the executor's interior-mutable state: the
//! live catalog and the cached machine id.

use std::sync::{RwLock, RwLockReadGuard, RwLockWriteGuard};

use super::catalog::{QoderCatalog, SharedCatalog};

pub(super) fn read_catalog(catalog: &SharedCatalog) -> RwLockReadGuard<'_, QoderCatalog> {
    catalog
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub(super) fn write_catalog(catalog: &SharedCatalog) -> RwLockWriteGuard<'_, QoderCatalog> {
    catalog
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub(super) fn read_opt(handle: &RwLock<Option<String>>) -> Option<String> {
    handle
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

pub(super) fn write_opt(handle: &RwLock<Option<String>>) -> RwLockWriteGuard<'_, Option<String>> {
    handle
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
