//! Customer accounts: the `/v1/users` admin CRUD over the `users` table and the
//! login tokens those accounts use.

pub mod model;
pub mod routes;

pub use model::{
    CreateUserInput, CreatedUser, UpdateUserInput, User, generate_user_id, generate_user_token,
    user_token_prefix_of,
};
pub use routes::create_users_router;
