//! Admin session mechanics owned by the admin login feature.

pub mod session;

pub use session::{
    ADMIN_SESSION_COOKIE, AdminSessionStore, EmptyAdminSessionStore, hash_session_token,
};
