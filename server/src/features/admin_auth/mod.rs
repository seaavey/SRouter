//! Admin authentication: password hashing, session mechanics, account/session
//! persistence, login throttling, and the `/v1/admin` routes.

pub mod password;
pub mod repository;
pub mod routes;
pub mod session;
pub mod throttle;

pub use password::{hash_admin_password, validate_admin_password, verify_admin_password};
pub use repository::{AdminAuthRepository, EmptyAdminAuthRepository};
pub use routes::create_admin_router;
pub use session::{
    ADMIN_SESSION_COOKIE, ADMIN_SESSION_TTL_MS, AdminSessionStore, EmptyAdminSessionStore,
    generate_session_token, hash_session_token,
};
pub use throttle::LoginThrottle;
