//! Manual capture of the real `model/list` body, run with `--ignored`: it signs one
//! GET with the stored account so catalog fields keep provenance instead of guesswork.
//! Requires `DATABASE_PATH` to point at a copy of the live database, never the original.

use std::collections::{BTreeMap, HashMap};

use srouter_server::config::APIConfig;
use srouter_server::features::providers::qoder::cosy::{CosyIdentity, sign};
use srouter_server::features::providers::qoder::executor::machine_id_for;
use srouter_server::features::providers::qoder::types::QODER_USER_AGENT;
use srouter_server::features::providers::qoder::types::QoderEndpoints;
use srouter_server::infrastructure::database::AppDatabase;
use srouter_server::infrastructure::database::providers::load_qoder_credentials;

#[tokio::test]
#[ignore = "reaches the real Qoder gateway with the stored account"]
async fn prints_the_live_model_list_body() {
    let environment: HashMap<String, String> = std::env::vars().collect();
    assert!(
        environment.contains_key("DATABASE_PATH"),
        "set DATABASE_PATH to a copied database"
    );

    let config = APIConfig::from_env_map(&environment).expect("configuration reads");
    let database = AppDatabase::connect(&config)
        .await
        .expect("database connects");
    let credentials = load_qoder_credentials(&database)
        .await
        .expect("credentials load")
        .into_iter()
        .next()
        .expect("a qoder connection is stored");
    let machine_id = machine_id_for(&database).await.expect("machine id reads");

    let url = QoderEndpoints::default().model_list_url();
    let headers: BTreeMap<&'static str, String> = sign(
        "",
        &url,
        &CosyIdentity {
            uid: &credentials.user_id,
            auth_token: &credentials.access_token,
            name: &credentials.name,
            email: &credentials.email,
            machine_id: &machine_id,
        },
        (srouter_server::clock::now_ms() / 1000) as u64,
        &uuid::Uuid::new_v4().to_string(),
    )
    .expect("request signs");

    let mut request = reqwest::Client::new()
        .get(&url)
        .timeout(std::time::Duration::from_secs(20))
        .header("User-Agent", QODER_USER_AGENT)
        .header("Accept", "application/json")
        .header("Accept-Encoding", "identity");

    for (name, value) in &headers {
        request = request.header(*name, value);
    }

    let response = request.send().await.expect("upstream answers");
    let status = response.status();
    let body = response.text().await.expect("body reads");

    println!("status: {status}");
    println!("url: {url}");
    println!("body: {body}");

    let parsed: serde_json::Value = serde_json::from_str(&body).expect("body is json");
    let entries = parsed.get("chat").and_then(serde_json::Value::as_array);

    match entries {
        Some(list) => {
            println!("entries: {}", list.len());

            for entry in list {
                println!("entry: {entry}");
            }
        }
        None => println!("no chat array in the response"),
    }
}
