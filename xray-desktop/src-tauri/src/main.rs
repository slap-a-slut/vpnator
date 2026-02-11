#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Command;
#[cfg(any(target_os = "linux", target_os = "windows"))]
use tauri_plugin_deep_link::DeepLinkExt;

#[derive(Debug, Deserialize)]
struct BridgeResponse {
  ok: bool,
  data: Option<Value>,
  error: Option<String>,
}

fn bridge_script_path() -> PathBuf {
  PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    .join("..")
    .join("backend")
    .join("desktop-bridge.cjs")
}

fn node_binary() -> String {
  std::env::var("NODE_BINARY").unwrap_or_else(|_| "node".to_string())
}

fn run_bridge(action: &str, payload: Value) -> Result<Value, String> {
  let payload_json = serde_json::to_string(&payload).map_err(|error| error.to_string())?;
  let output = Command::new(node_binary())
    .arg(bridge_script_path())
    .arg(action)
    .arg(payload_json)
    .output()
    .map_err(|error| format!("Failed to run bridge: {}", error))?;

  let stdout = String::from_utf8(output.stdout).map_err(|error| error.to_string())?;
  let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
  let stdout_trimmed = stdout.trim();

  if stdout_trimmed.is_empty() {
    if stderr.is_empty() {
      return Err("Bridge returned empty response".to_string());
    }

    return Err(stderr);
  }

  let response: BridgeResponse =
    serde_json::from_str(stdout_trimmed).map_err(|error| format!("Invalid bridge JSON: {}", error))?;

  if response.ok {
    return Ok(response.data.unwrap_or(Value::Null));
  }

  let message = response
    .error
    .or_else(|| if stderr.is_empty() { None } else { Some(stderr) })
    .unwrap_or_else(|| "Unknown bridge error".to_string());
  Err(message)
}

#[allow(non_snake_case)]
#[tauri::command]
fn importToken(baseUrl: String, token: String) -> Result<(), String> {
  run_bridge("importToken", json!({ "baseUrl": baseUrl, "token": token })).map(|_| ())
}

#[tauri::command]
fn connect() -> Result<Value, String> {
  run_bridge("connect", Value::Null)
}

#[tauri::command]
#[allow(non_snake_case)]
fn setMode(mode: String) -> Result<Value, String> {
  run_bridge("setMode", json!({ "mode": mode }))
}

#[tauri::command]
fn disconnect() -> Result<(), String> {
  run_bridge("disconnect", Value::Null).map(|_| ())
}

#[allow(non_snake_case)]
#[tauri::command]
fn updateDisguise(
  baseUrl: String,
  serverId: String,
  adminApiKey: String,
  disguise: Value,
) -> Result<Value, String> {
  run_bridge(
    "updateDisguise",
    json!({
      "baseUrl": baseUrl,
      "serverId": serverId,
      "adminApiKey": adminApiKey,
      "disguise": disguise
    }),
  )
}

#[tauri::command]
fn status() -> Result<Value, String> {
  run_bridge("status", Value::Null)
}

fn main() {
  tauri::Builder::default()
    .setup(|_app| {
      #[cfg(any(target_os = "linux", target_os = "windows"))]
      {
        _app.deep_link().register_all()?;
      }

      Ok(())
    })
    .plugin(tauri_plugin_deep_link::init())
    .invoke_handler(tauri::generate_handler![
      importToken,
      connect,
      setMode,
      updateDisguise,
      disconnect,
      status
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
