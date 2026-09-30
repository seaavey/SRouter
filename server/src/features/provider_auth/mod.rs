//! Provider authentication routes under `/v1/auth/*`. Only the Qoder driver is
//! served here; the other providers keep their routes on the Node build until
//! their own slice lands.

mod qoder;

pub use qoder::{create_qoder_callback_router, create_qoder_login_router};
