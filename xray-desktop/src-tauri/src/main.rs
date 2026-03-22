#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Deserialize;
use serde_json::{json, Value};
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::Command;
use std::sync::OnceLock;
use tauri::Manager;
use tauri_plugin_clipboard_manager::ClipboardExt;
#[cfg(any(target_os = "linux", target_os = "windows"))]
use tauri_plugin_deep_link::DeepLinkExt;

static RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();

#[derive(Debug, Deserialize)]
struct BridgeResponse {
  ok: bool,
  data: Option<Value>,
  error: Option<String>,
}

fn backend_dir_path() -> PathBuf {
  PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    .join("..")
    .join("backend")
}

fn bridge_script_path() -> PathBuf {
  backend_dir_path().join("desktop-bridge.cjs")
}

fn runtime_dir_path() -> PathBuf {
  backend_dir_path().join("runtime")
}

#[cfg(target_os = "windows")]
fn bundled_node_file_name() -> &'static str {
  "node.exe"
}

#[cfg(not(target_os = "windows"))]
fn bundled_node_file_name() -> &'static str {
  "node"
}

fn resource_path(relative_path: &str) -> Option<PathBuf> {
  RESOURCE_DIR
    .get()
    .map(|resource_dir| resource_dir.join(relative_path))
}

#[cfg(target_os = "windows")]
fn common_node_binary_paths() -> Vec<PathBuf> {
  let mut candidates = Vec::new();

  for env_name in ["ProgramFiles", "ProgramFiles(x86)"] {
    if let Ok(base_dir) = std::env::var(env_name) {
      candidates.push(PathBuf::from(base_dir).join("nodejs").join("node.exe"));
    }
  }

  candidates
}

#[cfg(not(target_os = "windows"))]
fn common_node_binary_paths() -> Vec<PathBuf> {
  vec![
    PathBuf::from("/opt/homebrew/bin/node"),
    PathBuf::from("/usr/local/bin/node"),
    PathBuf::from("/usr/bin/node"),
  ]
}

fn resolve_bridge_script_path() -> Result<PathBuf, String> {
  let source_path = bridge_script_path();
  if source_path.exists() {
    return Ok(source_path);
  }

  if let Some(candidate) = resource_path("backend/desktop-bridge.cjs") {
    if candidate.exists() {
      return Ok(candidate);
    }
  }

  Err("Bridge script desktop-bridge.cjs was not found".to_string())
}

fn resolve_node_binary() -> OsString {
  if let Ok(node_binary) = std::env::var("NODE_BINARY") {
    let trimmed = node_binary.trim();
    if !trimmed.is_empty() {
      return OsString::from(trimmed);
    }
  }

  let bundled_source = runtime_dir_path().join(bundled_node_file_name());
  if bundled_source.exists() {
    return bundled_source.into_os_string();
  }

  if let Some(bundled_resource) =
    resource_path(&format!("backend/runtime/{}", bundled_node_file_name()))
  {
    if bundled_resource.exists() {
      return bundled_resource.into_os_string();
    }
  }

  for candidate in common_node_binary_paths() {
    if candidate.exists() {
      return candidate.into_os_string();
    }
  }

  OsString::from("node")
}

fn is_admin_build() -> bool {
  option_env!("XRAY_DESKTOP_VARIANT")
    .unwrap_or("user")
    .eq_ignore_ascii_case("admin")
}

fn run_bridge(action: &str, payload: Value) -> Result<Value, String> {
  let payload_json = serde_json::to_string(&payload).map_err(|error| error.to_string())?;
  let bridge_script = resolve_bridge_script_path()?;
  let node_binary = resolve_node_binary();

  let mut command = Command::new(node_binary);
  command.env(
    "DESKTOP_ADMIN_FEATURES",
    if is_admin_build() { "true" } else { "false" },
  );

  let output = command
    .arg(bridge_script)
    .arg(action)
    .arg(payload_json)
    .output()
    .map_err(|error| format!("Failed to run bridge with Node.js: {}", error))?;

  let stdout = String::from_utf8(output.stdout).map_err(|error| error.to_string())?;
  let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
  let stdout_trimmed = stdout.trim();

  if !output.status.success() {
    let message = if !stderr.is_empty() {
      stderr
    } else if !stdout_trimmed.is_empty() {
      stdout_trimmed.to_string()
    } else {
      format!("Bridge process exited with status {}", output.status)
    };
    return Err(message);
  }

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
async fn ensureLocalControlPlane(projectRoot: String) -> Result<Value, String> {
  if !is_admin_build() {
    return Err("Admin features are disabled in this build".to_string());
  }

  let trimmed_root = projectRoot.trim().to_string();
  if trimmed_root.is_empty() {
    return Err("projectRoot is required".to_string());
  }

  let result = tauri::async_runtime::spawn_blocking(move || {
    let script_path = PathBuf::from(&trimmed_root).join("scripts").join("bootstrap-macos.sh");
    if !script_path.exists() {
      return Err(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        format!("Bootstrap script not found: {}", script_path.display()),
      ));
    }

    let mut command = Command::new("/bin/bash");
    command
      .arg(script_path)
      .current_dir(&trimmed_root)
      .env(
        "PATH",
        "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/opt/node@20/bin:/usr/local/opt/node@20/bin",
      );
    command.output()
  })
  .await
  .map_err(|error| format!("Failed to run bootstrap task: {error}"))?
  .map_err(|error| format!("Failed to spawn bootstrap script: {error}"))?;

  let stdout = String::from_utf8_lossy(&result.stdout).to_string();
  let stderr = String::from_utf8_lossy(&result.stderr).to_string();

  if !result.status.success() {
    let mut message = String::from("Bootstrap failed");
    if !stderr.trim().is_empty() {
      message.push_str(": ");
      message.push_str(stderr.trim());
    } else if !stdout.trim().is_empty() {
      message.push_str(": ");
      message.push_str(stdout.trim());
    }
    return Err(message);
  }

  Ok(json!({
    "ok": true,
    "stdout": stdout,
    "stderr": stderr
  }))
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

#[allow(non_snake_case)]
#[tauri::command]
fn serverLogin(
  baseUrl: String,
  adminApiKey: String,
  host: String,
  sshUser: String,
  password: String,
) -> Result<Value, String> {
  if !is_admin_build() {
    return Err("Admin features are disabled in this build".to_string());
  }

  run_bridge(
    "serverLogin",
    json!({
      "baseUrl": baseUrl,
      "adminApiKey": adminApiKey,
      "host": host,
      "sshUser": sshUser,
      "password": password
    }),
  )
}

#[allow(non_snake_case)]
#[tauri::command]
fn getJobStatus(baseUrl: String, adminApiKey: String, jobId: String) -> Result<Value, String> {
  if !is_admin_build() {
    return Err("Admin features are disabled in this build".to_string());
  }

  run_bridge(
    "getJobStatus",
    json!({
      "baseUrl": baseUrl,
      "adminApiKey": adminApiKey,
      "jobId": jobId
    }),
  )
}

#[allow(non_snake_case)]
#[tauri::command]
fn getServers(baseUrl: String, adminApiKey: String) -> Result<Value, String> {
  if !is_admin_build() {
    return Err("Admin features are disabled in this build".to_string());
  }

  run_bridge(
    "getServers",
    json!({
      "baseUrl": baseUrl,
      "adminApiKey": adminApiKey
    }),
  )
}

#[allow(non_snake_case)]
#[tauri::command]
fn reinstallServer(baseUrl: String, adminApiKey: String, serverId: String) -> Result<Value, String> {
  if !is_admin_build() {
    return Err("Admin features are disabled in this build".to_string());
  }

  run_bridge(
    "reinstallServer",
    json!({
      "baseUrl": baseUrl,
      "adminApiKey": adminApiKey,
      "serverId": serverId
    }),
  )
}

#[allow(non_snake_case)]
#[tauri::command]
fn deleteServer(baseUrl: String, adminApiKey: String, serverId: String) -> Result<Value, String> {
  if !is_admin_build() {
    return Err("Admin features are disabled in this build".to_string());
  }

  run_bridge(
    "deleteServer",
    json!({
      "baseUrl": baseUrl,
      "adminApiKey": adminApiKey,
      "serverId": serverId
    }),
  )
}

#[allow(non_snake_case)]
#[tauri::command]
fn listAdminUsers(baseUrl: String, adminApiKey: String, filters: Value) -> Result<Value, String> {
  if !is_admin_build() {
    return Err("Admin features are disabled in this build".to_string());
  }

  run_bridge(
    "listAdminUsers",
    json!({
      "baseUrl": baseUrl,
      "adminApiKey": adminApiKey,
      "filters": filters
    }),
  )
}

#[allow(non_snake_case)]
#[tauri::command]
fn listAdminTokens(baseUrl: String, adminApiKey: String, filters: Value) -> Result<Value, String> {
  if !is_admin_build() {
    return Err("Admin features are disabled in this build".to_string());
  }

  run_bridge(
    "listAdminTokens",
    json!({
      "baseUrl": baseUrl,
      "adminApiKey": adminApiKey,
      "filters": filters
    }),
  )
}

#[allow(non_snake_case)]
#[tauri::command]
fn listAuditEvents(baseUrl: String, adminApiKey: String, filters: Value) -> Result<Value, String> {
  if !is_admin_build() {
    return Err("Admin features are disabled in this build".to_string());
  }

  run_bridge(
    "listAuditEvents",
    json!({
      "baseUrl": baseUrl,
      "adminApiKey": adminApiKey,
      "filters": filters
    }),
  )
}

#[allow(non_snake_case)]
#[tauri::command]
fn createServerUser(
  baseUrl: String,
  adminApiKey: String,
  serverId: String,
  name: Option<String>,
  notes: Option<String>,
) -> Result<Value, String> {
  if !is_admin_build() {
    return Err("Admin features are disabled in this build".to_string());
  }

  run_bridge(
    "createServerUser",
    json!({
      "baseUrl": baseUrl,
      "adminApiKey": adminApiKey,
      "serverId": serverId,
      "name": name,
      "notes": notes
    }),
  )
}

#[allow(non_snake_case)]
#[tauri::command]
fn deleteAdminUser(baseUrl: String, adminApiKey: String, userId: String) -> Result<Value, String> {
  if !is_admin_build() {
    return Err("Admin features are disabled in this build".to_string());
  }

  run_bridge(
    "deleteAdminUser",
    json!({
      "baseUrl": baseUrl,
      "adminApiKey": adminApiKey,
      "userId": userId
    }),
  )
}

#[allow(non_snake_case)]
#[tauri::command]
fn updateAdminUserAccess(
  baseUrl: String,
  adminApiKey: String,
  userId: String,
  accessEnabled: bool,
) -> Result<Value, String> {
  if !is_admin_build() {
    return Err("Admin features are disabled in this build".to_string());
  }

  run_bridge(
    "updateAdminUserAccess",
    json!({
      "baseUrl": baseUrl,
      "adminApiKey": adminApiKey,
      "userId": userId,
      "accessEnabled": accessEnabled
    }),
  )
}

#[allow(non_snake_case)]
#[tauri::command]
fn updateAdminUserPayment(
  baseUrl: String,
  adminApiKey: String,
  userId: String,
  paymentStatus: String,
) -> Result<Value, String> {
  if !is_admin_build() {
    return Err("Admin features are disabled in this build".to_string());
  }

  run_bridge(
    "updateAdminUserPayment",
    json!({
      "baseUrl": baseUrl,
      "adminApiKey": adminApiKey,
      "userId": userId,
      "paymentStatus": paymentStatus
    }),
  )
}

#[allow(non_snake_case)]
#[tauri::command]
fn createAdminToken(
  baseUrl: String,
  adminApiKey: String,
  userId: Option<String>,
  label: String,
  ttlDays: Option<i64>,
  ttlHours: Option<i64>,
  ttlMinutes: Option<i64>,
  maxUses: Option<i64>,
) -> Result<Value, String> {
  if !is_admin_build() {
    return Err("Admin features are disabled in this build".to_string());
  }

  run_bridge(
    "createAdminToken",
    json!({
      "baseUrl": baseUrl,
      "adminApiKey": adminApiKey,
      "userId": userId,
      "label": label,
      "ttlDays": ttlDays,
      "ttlHours": ttlHours,
      "ttlMinutes": ttlMinutes,
      "maxUses": maxUses
    }),
  )
}

#[allow(non_snake_case)]
#[tauri::command]
fn deleteAdminToken(baseUrl: String, adminApiKey: String, tokenId: String) -> Result<Value, String> {
  if !is_admin_build() {
    return Err("Admin features are disabled in this build".to_string());
  }

  run_bridge(
    "deleteAdminToken",
    json!({
      "baseUrl": baseUrl,
      "adminApiKey": adminApiKey,
      "tokenId": tokenId
    }),
  )
}

#[allow(non_snake_case)]
#[tauri::command]
fn getUserConfig(baseUrl: String, adminApiKey: String, userId: String) -> Result<Value, String> {
  if !is_admin_build() {
    return Err("Admin features are disabled in this build".to_string());
  }

  run_bridge(
    "getUserConfig",
    json!({
      "baseUrl": baseUrl,
      "adminApiKey": adminApiKey,
      "userId": userId
    }),
  )
}

#[allow(non_snake_case)]
#[tauri::command]
fn getAdminUserAnalytics(
  baseUrl: String,
  adminApiKey: String,
  userId: String,
  scale: Option<String>,
  logsLimit: Option<i64>,
) -> Result<Value, String> {
  if !is_admin_build() {
    return Err("Admin features are disabled in this build".to_string());
  }

  run_bridge(
    "getAdminUserAnalytics",
    json!({
      "baseUrl": baseUrl,
      "adminApiKey": adminApiKey,
      "userId": userId,
      "scale": scale,
      "logsLimit": logsLimit
    }),
  )
}

#[allow(non_snake_case)]
#[tauri::command]
fn getAdminSiteAnalytics(
  baseUrl: String,
  adminApiKey: String,
  scale: Option<String>,
  recentLimit: Option<i64>,
) -> Result<Value, String> {
  if !is_admin_build() {
    return Err("Admin features are disabled in this build".to_string());
  }

  run_bridge(
    "getAdminSiteAnalytics",
    json!({
      "baseUrl": baseUrl,
      "adminApiKey": adminApiKey,
      "scale": scale,
      "recentLimit": recentLimit
    }),
  )
}

#[allow(non_snake_case)]
#[tauri::command]
fn getAdminUserIpUsage(
  baseUrl: String,
  adminApiKey: String,
  userId: String,
) -> Result<Value, String> {
  if !is_admin_build() {
    return Err("Admin features are disabled in this build".to_string());
  }

  run_bridge(
    "getAdminUserIpUsage",
    json!({
      "baseUrl": baseUrl,
      "adminApiKey": adminApiKey,
      "userId": userId
    }),
  )
}

#[allow(non_snake_case)]
#[tauri::command]
fn copyToClipboard(app: tauri::AppHandle, text: String) -> Result<(), String> {
  app.clipboard()
    .write_text(text)
    .map_err(|error| format!("Clipboard write failed: {error}"))
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
  if !is_admin_build() {
    return Err("Admin features are disabled in this build".to_string());
  }

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
    .setup(|app| {
      if let Ok(resource_dir) = app.path().resource_dir() {
        let _ = RESOURCE_DIR.set(resource_dir);
      }

      #[cfg(any(target_os = "linux", target_os = "windows"))]
      {
        app.deep_link().register_all()?;
      }

      Ok(())
    })
    .plugin(tauri_plugin_deep_link::init())
    .plugin(tauri_plugin_clipboard_manager::init())
    .invoke_handler(tauri::generate_handler![
      importToken,
      connect,
      serverLogin,
      getJobStatus,
      getServers,
      reinstallServer,
      deleteServer,
      listAdminUsers,
      listAdminTokens,
      listAuditEvents,
      createServerUser,
      deleteAdminUser,
      updateAdminUserAccess,
      updateAdminUserPayment,
      createAdminToken,
      deleteAdminToken,
      getUserConfig,
      getAdminUserAnalytics,
      getAdminSiteAnalytics,
      getAdminUserIpUsage,
      ensureLocalControlPlane,
      copyToClipboard,
      updateDisguise,
      disconnect,
      status
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
