use log::{error, info};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use zip::{write::SimpleFileOptions, ZipWriter};

// Track running install processes for cancellation
static NEXT_INSTALL_ID: AtomicU32 = AtomicU32::new(1);
lazy_static::lazy_static! {
    static ref RUNNING_INSTALLS: Mutex<HashMap<u32, Arc<AtomicBool>>> = Mutex::new(HashMap::new());
}

// Get extended PATH including common installation directories
fn get_extended_path() -> String {
    let current_path = env::var("PATH").unwrap_or_default();
    let home = env::var("HOME").unwrap_or_default();

    if cfg!(target_os = "macos") {
        // macOS common paths for Homebrew, MacPorts, TeX, npm global, etc.
        let mut extra_paths = vec![
            "/usr/local/bin".to_string(),
            "/opt/homebrew/bin".to_string(),
            "/opt/local/bin".to_string(),
            "/Library/TeX/texbin".to_string(),
            "/usr/texbin".to_string(),
            format!("{}/bin", home),
            format!("{}/.local/bin", home),
            format!("{}/.cargo/bin", home),
            // npm global paths
            format!("{}/.npm-global/bin", home),
            format!("{}/node_modules/.bin", home),
            "/usr/local/lib/node_modules/.bin".to_string(),
        ];

        // Find nvm node versions dynamically
        let nvm_dir = format!("{}/.nvm/versions/node", home);
        if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
            for entry in entries.flatten() {
                let bin_path = entry.path().join("bin");
                if bin_path.exists() {
                    extra_paths.push(bin_path.to_string_lossy().to_string());
                }
            }
        }

        format!("{}:{}", extra_paths.join(":"), current_path)
    } else if cfg!(target_os = "linux") {
        let extra_paths = vec![
            "/usr/local/bin".to_string(),
            format!("{}/bin", home),
            format!("{}/.local/bin", home),
            format!("{}/.cargo/bin", home),
            "/usr/local/texlive/2024/bin/x86_64-linux".to_string(),
            "/usr/local/texlive/2023/bin/x86_64-linux".to_string(),
            // npm global paths
            format!("{}/.npm-global/bin", home),
            "/usr/local/lib/node_modules/.bin".to_string(),
        ];
        format!("{}:{}", extra_paths.join(":"), current_path)
    } else if cfg!(target_os = "windows") {
        // Windows common paths for MiKTeX, npm, cargo, Chocolatey, Scoop
        let user_profile = env::var("USERPROFILE").unwrap_or_default();
        let app_data = env::var("APPDATA").unwrap_or_default();
        let local_app_data = env::var("LOCALAPPDATA").unwrap_or_default();
        let program_files =
            env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".to_string());

        let extra_paths = vec![
            // MiKTeX paths
            format!(
                "{}\\AppData\\Local\\Programs\\MiKTeX\\miktex\\bin\\x64",
                user_profile
            ),
            format!("{}\\miktex\\bin\\x64", program_files),
            // TeX Live paths
            "C:\\texlive\\2024\\bin\\windows".to_string(),
            "C:\\texlive\\2023\\bin\\windows".to_string(),
            // npm global paths
            format!("{}\\npm", app_data),
            format!("{}\\Roaming\\npm", app_data),
            // Cargo path
            format!("{}\\.cargo\\bin", user_profile),
            // Chocolatey
            "C:\\ProgramData\\chocolatey\\bin".to_string(),
            // Scoop
            format!("{}\\scoop\\shims", user_profile),
            // Pandoc default install location
            format!("{}\\Pandoc", local_app_data),
        ];
        format!("{};{}", extra_paths.join(";"), current_path)
    } else {
        current_path
    }
}

fn bundled_pandoc_resource_path() -> Option<&'static str> {
    if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        Some("pandoc/windows-x64/pandoc.exe")
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        Some("pandoc/linux-x64/pandoc")
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        Some("pandoc/macos-x64/pandoc")
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Some("pandoc/macos-aarch64/pandoc")
    } else {
        None
    }
}

fn bundled_tectonic_resource_path() -> Option<&'static str> {
    if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        Some("tectonic/windows-x64/tectonic.exe")
    } else {
        None
    }
}

fn get_bundled_pandoc_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let resource_path = bundled_pandoc_resource_path()?;
    let resolved = app
        .path()
        .resolve(resource_path, BaseDirectory::Resource)
        .ok()?;

    if resolved.exists() {
        resolved.parent().map(|parent| parent.to_path_buf())
    } else {
        None
    }
}

fn get_bundled_tectonic_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let resource_path = bundled_tectonic_resource_path()?;
    let resolved = app
        .path()
        .resolve(resource_path, BaseDirectory::Resource)
        .ok()?;

    if resolved.exists() {
        resolved.parent().map(|parent| parent.to_path_buf())
    } else {
        None
    }
}

fn get_bundled_pandoc_executable<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let resource_path = bundled_pandoc_resource_path()?;
    let resolved = app
        .path()
        .resolve(resource_path, BaseDirectory::Resource)
        .ok()?;

    if resolved.exists() {
        Some(resolved)
    } else {
        None
    }
}

fn normalize_windows_path(path: &Path) -> String {
    let path_text = path.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        path_text
            .strip_prefix(r"\\?\")
            .unwrap_or(&path_text)
            .to_string()
    }

    #[cfg(not(target_os = "windows"))]
    {
        path_text
    }
}

fn build_command_path<R: Runtime>(app: &AppHandle<R>) -> String {
    let extended_path = get_extended_path();
    let separator = if cfg!(target_os = "windows") { ";" } else { ":" };
    let mut dirs = Vec::new();

    if let Some(bundled_dir) = get_bundled_pandoc_dir(app) {
        dirs.push(normalize_windows_path(&bundled_dir));
    }

    if let Some(bundled_dir) = get_bundled_tectonic_dir(app) {
        let normalized = normalize_windows_path(&bundled_dir);
        if !dirs.contains(&normalized) {
            dirs.push(normalized);
        }
    }

    if dirs.is_empty() {
        extended_path
    } else {
        format!("{}{}{}", dirs.join(separator), separator, extended_path)
    }
}

fn should_replace_pandoc_command(command: &str) -> bool {
    let trimmed = command.trim_start();
    trimmed == "pandoc"
        || trimmed
            .strip_prefix("pandoc")
            .map(|rest| rest.is_empty() || rest.starts_with(char::is_whitespace))
            .unwrap_or(false)
}

fn resolve_command_binary<R: Runtime>(app: &AppHandle<R>, command: &str) -> String {
    if !should_replace_pandoc_command(command) {
        return command.to_string();
    }

    let Some(pandoc_path) = get_bundled_pandoc_executable(app) else {
        return command.to_string();
    };

    let trimmed = command.trim_start();
    let leading_ws_len = command.len() - trimmed.len();
    let rest = &trimmed["pandoc".len()..];
    let quoted = format!("\"{}\"", normalize_windows_path(&pandoc_path));

    format!("{}{}{}", &command[..leading_ws_len], quoted, rest)
}

fn wrap_windows_command(command: &str) -> String {
    if cfg!(target_os = "windows") {
        // Force UTF-8 console output so stderr/stdout from cmd can be decoded correctly.
        format!("chcp 65001>nul && {}", command)
    } else {
        command.to_string()
    }
}

fn looks_like_utf16_le(bytes: &[u8]) -> bool {
    if bytes.len() < 2 || bytes.len() % 2 != 0 {
        return false;
    }

    if bytes.starts_with(&[0xFF, 0xFE]) {
        return true;
    }

    let total_pairs = bytes.len() / 2;
    let zero_high_bytes = bytes.chunks_exact(2).filter(|chunk| chunk[1] == 0).count();

    zero_high_bytes * 2 >= total_pairs
}

fn decode_command_output(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return String::new();
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(text) = String::from_utf8(bytes.to_vec()) {
            return text;
        }

        let (gbk_text, _, had_errors) = encoding_rs::GBK.decode(bytes);
        if !had_errors {
            return gbk_text.into_owned();
        }

        if looks_like_utf16_le(bytes) {
            let utf16: Vec<u16> = bytes
                .chunks_exact(2)
                .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
                .collect();

            if let Ok(text) = String::from_utf16(&utf16) {
                return text;
            }
        }
    }

    String::from_utf8_lossy(bytes).to_string()
}

fn decode_command_line(bytes: &[u8]) -> String {
    decode_command_output(bytes)
        .trim_end_matches(['\r', '\n'])
        .to_string()
}

#[cfg(target_os = "windows")]
fn parse_windows_command_line(command: &str) -> Result<Vec<String>, String> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::UI::Shell::CommandLineToArgvW;

    fn wide_ptr_to_string(ptr: *const u16) -> String {
        let mut len = 0usize;
        unsafe {
            while *ptr.add(len) != 0 {
                len += 1;
            }
            String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len))
        }
    }

    let wide: Vec<u16> = command.encode_utf16().chain(std::iter::once(0)).collect();
    let mut argc = 0;
    let argv = unsafe { CommandLineToArgvW(wide.as_ptr(), &mut argc) };

    if argv.is_null() || argc <= 0 {
        return Err("Failed to parse Windows command line".to_string());
    }

    let args = unsafe {
        std::slice::from_raw_parts(argv, argc as usize)
            .iter()
            .map(|ptr| wide_ptr_to_string(*ptr))
            .collect::<Vec<_>>()
    };

    unsafe {
        let _ = LocalFree(argv.cast());
    }

    Ok(args)
}

#[cfg(not(target_os = "windows"))]
fn parse_windows_command_line(_command: &str) -> Result<Vec<String>, String> {
    Err("Windows command parsing is only available on Windows".to_string())
}

#[tauri::command]
fn check_command(app: AppHandle, command: String) -> Result<String, String> {
    let command_path = build_command_path(&app);
    let resolved_command = resolve_command_binary(&app, &command);

    let output = if cfg!(target_os = "windows") {
        if should_replace_pandoc_command(&command) {
            let argv = parse_windows_command_line(&resolved_command)?;
            let mut process = Command::new(&argv[0]);
            process.args(&argv[1..]).env("PATH", &command_path);
            process.output()
        } else {
            let wrapped = wrap_windows_command(&resolved_command);
            Command::new("cmd")
                .args(["/C", &wrapped])
                .env("PATH", &command_path)
                .output()
        }
    } else {
        Command::new("sh")
            .args(["-c", &resolved_command])
            .env("PATH", &command_path)
            .output()
    };

    match output {
        Ok(output) => {
            if output.status.success() {
                Ok(decode_command_output(&output.stdout))
            } else {
                Err(format!(
                    "Command failed: {}",
                    decode_command_output(&output.stderr)
                ))
            }
        }
        Err(e) => Err(format!("Failed to execute: {}", e)),
    }
}

#[tauri::command]
fn run_pandoc(app: AppHandle, command: String) -> Result<String, String> {
    info!("Running pandoc command: {}", command);
    let command_path = build_command_path(&app);
    let resolved_command = resolve_command_binary(&app, &command);
    let home = env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let temp_dir = env::temp_dir();

    // Try to copy mermaid config file to home directory if it exists in the bundle
    // This ensures mermaid-filter uses proper configuration for SVG rendering with text
    let app_dir = env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.to_path_buf()));

    if let Some(app_dir) = app_dir {
        // Try multiple possible locations for the config file
        let possible_paths = vec![
            app_dir.join(".mermaid-config.json"),
            app_dir
                .parent()
                .and_then(|p| p.parent())
                .map(|p| p.join(".mermaid-config.json"))
                .unwrap_or_default(),
        ];

        for config_path in possible_paths {
            if config_path.exists() {
                let home_config = Path::new(&home).join(".mermaid-config.json");
                let _ = fs::copy(&config_path, &home_config);
                break;
            }
        }
    }

    // Detect output format from command to optimize mermaid rendering
    // For PDF output: use PDF format (best quality, scalable, embeds perfectly)
    // For HTML/EPUB: use SVG format (scalable, lightweight)
    let mermaid_format =
        if resolved_command.contains("-t pdf") || resolved_command.contains("-t=pdf") {
            "pdf" // PDF format embeds perfectly in PDF output with full quality
        } else {
            "svg" // SVG is best for HTML/EPUB (scalable, lightweight)
        };

    let output = if cfg!(target_os = "windows") {
        let argv = parse_windows_command_line(&resolved_command)?;
        let mut process = Command::new(&argv[0]);
        process
            .args(&argv[1..])
            .env("PATH", &command_path)
            .env("MERMAID_FILTER_FORMAT", mermaid_format)
            .env("MERMAID_FILTER_BACKGROUND", "transparent");
        process.output()
    } else {
        Command::new("sh")
            .args(["-c", &resolved_command])
            .env("PATH", &command_path)
            // Set working directory to home to avoid read-only filesystem issues
            .current_dir(&home)
            // Redirect mermaid-filter error log to temp directory
            .env("MERMAID_FILTER_ERR", temp_dir.join("mermaid-filter.err"))
            // Configure mermaid-filter format based on output type
            .env("MERMAID_FILTER_FORMAT", mermaid_format)
            .env("MERMAID_FILTER_BACKGROUND", "transparent")
            .output()
    };

    match output {
        Ok(output) => {
            if output.status.success() {
                info!("Pandoc command completed successfully");
                Ok(decode_command_output(&output.stdout))
            } else {
                let stderr = decode_command_output(&output.stderr);
                let stdout = decode_command_output(&output.stdout);
                error!("Pandoc command failed: {}\n{}", stderr, stdout);
                Err(format!("{}\n{}", stderr, stdout))
            }
        }
        Err(e) => {
            error!("Failed to execute pandoc: {}", e);
            Err(format!("Failed to execute pandoc: {}", e))
        }
    }
}

#[tauri::command]
fn open_file(path: String) -> Result<(), String> {
    open::that(&path).map_err(|e| format!("Failed to open file: {}", e))
}

#[tauri::command]
fn get_downloads_path() -> Result<String, String> {
    dirs::download_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Could not find Downloads directory".to_string())
}

#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("Failed to reveal in Finder: {}", e))?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| format!("Failed to reveal in Explorer: {}", e))?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        // Try xdg-open on the parent directory
        if let Some(parent) = Path::new(&path).parent() {
            Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|e| format!("Failed to open file manager: {}", e))?;
        }
        Ok(())
    }
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// Run a command with streaming output to the frontend
#[tauri::command]
async fn run_command_with_output(
    app: AppHandle,
    command: String,
    operation: String,
) -> Result<String, String> {
    let command_path = build_command_path(&app);
    let install_id = NEXT_INSTALL_ID.fetch_add(1, Ordering::SeqCst);
    let cancelled = Arc::new(AtomicBool::new(false));

    // Store cancel flag
    {
        let mut installs = RUNNING_INSTALLS.lock().unwrap();
        installs.insert(install_id, cancelled.clone());
    }

    // Emit start event
    let _ = app.emit(
        "command-output",
        serde_json::json!({
            "type": "start",
            "id": install_id,
            "operation": operation,
            "command": command
        }),
    );

    let app_clone = app.clone();
    let cancelled_clone = cancelled.clone();
    let operation_clone = operation.clone();

    let result = tokio::task::spawn_blocking(move || {
        let mut child = if cfg!(target_os = "windows") {
            let wrapped = wrap_windows_command(&command);
            Command::new("cmd")
                .args(["/C", &wrapped])
                .env("PATH", &command_path)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
        } else {
            Command::new("sh")
                .args(["-c", &command])
                .env("PATH", &command_path)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
        }
        .map_err(|e| format!("Failed to start: {}", e))?;

        // Read stdout in a separate thread
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let app_stdout = app_clone.clone();
        let app_stderr = app_clone.clone();

        let stdout_handle = std::thread::spawn(move || {
            if let Some(stdout) = stdout {
                let mut reader = BufReader::new(stdout);
                let mut buffer = Vec::new();
                while reader.read_until(b'\n', &mut buffer).unwrap_or(0) > 0 {
                    let line = decode_command_line(&buffer);
                    let _ = app_stdout.emit(
                        "command-output",
                        serde_json::json!({
                            "type": "stdout",
                            "line": line
                        }),
                    );
                    buffer.clear();
                }
            }
        });

        let stderr_handle = std::thread::spawn(move || {
            if let Some(stderr) = stderr {
                let mut reader = BufReader::new(stderr);
                let mut buffer = Vec::new();
                while reader.read_until(b'\n', &mut buffer).unwrap_or(0) > 0 {
                    let line = decode_command_line(&buffer);
                    let _ = app_stderr.emit(
                        "command-output",
                        serde_json::json!({
                            "type": "stderr",
                            "line": line
                        }),
                    );
                    buffer.clear();
                }
            }
        });

        // Wait for process
        let status = child.wait().map_err(|e| format!("Wait failed: {}", e))?;

        // Wait for output threads
        let _ = stdout_handle.join();
        let _ = stderr_handle.join();

        // Check if cancelled
        if cancelled_clone.load(Ordering::SeqCst) {
            return Err("Operation cancelled".to_string());
        }

        if status.success() {
            Ok(format!("{} completed successfully", operation_clone))
        } else {
            Err(format!(
                "{} failed with exit code: {:?}",
                operation_clone,
                status.code()
            ))
        }
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?;

    // Clean up
    {
        let mut installs = RUNNING_INSTALLS.lock().unwrap();
        installs.remove(&install_id);
    }

    // Emit end event
    let _ = app.emit(
        "command-output",
        serde_json::json!({
            "type": "end",
            "id": install_id,
            "success": result.is_ok(),
            "message": result.as_ref().map(|s| s.as_str()).unwrap_or_else(|e| e.as_str())
        }),
    );

    result
}

#[tauri::command]
fn cancel_all_installs() -> Result<String, String> {
    let installs = RUNNING_INSTALLS.lock().map_err(|e| e.to_string())?;
    let count = installs.len();

    for (_, cancelled) in installs.iter() {
        cancelled.store(true, Ordering::SeqCst);
    }

    Ok(format!("Cancelling {} operation(s)", count))
}

// Get the uninstall command for a dependency
// Uses osascript on macOS for commands requiring admin privileges (shows native password dialog)
fn get_uninstall_command(name: &str) -> Option<String> {
    match name {
        "tectonic" => {
            Some("brew uninstall tectonic 2>&1 || cargo uninstall tectonic 2>&1".to_string())
        }
        "texlive" => {
            if cfg!(target_os = "macos") {
                Some(r#"ASKPASS_SCRIPT=$(mktemp) && cat > "$ASKPASS_SCRIPT" << 'ASKPASSEOF'
#!/bin/bash
osascript -e 'display dialog "Pandoc GUI needs your password to uninstall BasicTeX:" default answer "" with hidden answer buttons {"Cancel","OK"} default button "OK"' -e 'text returned of result' 2>/dev/null
ASKPASSEOF
chmod +x "$ASKPASS_SCRIPT" && SUDO_ASKPASS="$ASKPASS_SCRIPT" brew uninstall --cask basictex 2>&1 || brew uninstall --cask mactex 2>&1; EXIT_CODE=$?; rm -f "$ASKPASS_SCRIPT"; exit $EXIT_CODE"#.to_string())
            } else {
                Some(
                    "brew uninstall --cask basictex 2>&1 || brew uninstall --cask mactex 2>&1"
                        .to_string(),
                )
            }
        }
        "mermaid-filter" => {
            if cfg!(target_os = "macos") {
                // Try without sudo first (works if npm prefix is user-writable), fall back to sudo with askpass
                Some(r#"npm uninstall -g mermaid-filter 2>&1 || (ASKPASS_SCRIPT=$(mktemp) && cat > "$ASKPASS_SCRIPT" << 'ASKPASSEOF'
#!/bin/bash
osascript -e 'display dialog "Pandoc GUI needs your password to uninstall mermaid-filter:" default answer "" with hidden answer buttons {"Cancel","OK"} default button "OK"' -e 'text returned of result' 2>/dev/null
ASKPASSEOF
chmod +x "$ASKPASS_SCRIPT" && SUDO_ASKPASS="$ASKPASS_SCRIPT" sudo -A npm uninstall -g mermaid-filter 2>&1; EXIT_CODE=$?; rm -f "$ASKPASS_SCRIPT"; exit $EXIT_CODE)"#.to_string())
            } else if cfg!(target_os = "linux") {
                Some("npm uninstall -g mermaid-filter 2>&1 || pkexec npm uninstall -g mermaid-filter 2>&1".to_string())
            } else {
                Some("npm uninstall -g mermaid-filter 2>&1".to_string())
            }
        }
        "pandoc-crossref" => Some("brew uninstall pandoc-crossref 2>&1".to_string()),
        "pandoc" => Some("brew uninstall pandoc 2>&1".to_string()),
        _ => None,
    }
}

// Get the install command for a dependency
// Uses osascript on macOS for commands requiring admin privileges (shows native password dialog)
// Uses pkexec on Linux for GUI sudo prompt
fn get_install_command(name: &str, method: &str) -> Option<String> {
    match (name, method) {
        ("tectonic", "brew") => Some("brew install tectonic 2>&1".to_string()),
        ("tectonic", "cargo") => Some("cargo install tectonic 2>&1".to_string()),
        ("texlive", "brew") => {
            if cfg!(target_os = "macos") {
                // brew cask installs need sudo for the pkg installer
                // Use SUDO_ASKPASS with osascript to show native password dialog
                // Homebrew can't run as root, so we provide an askpass helper instead
                Some(r#"ASKPASS_SCRIPT=$(mktemp) && cat > "$ASKPASS_SCRIPT" << 'ASKPASSEOF'
#!/bin/bash
osascript -e 'display dialog "Pandoc GUI needs your password to install BasicTeX:" default answer "" with hidden answer buttons {"Cancel","OK"} default button "OK"' -e 'text returned of result' 2>/dev/null
ASKPASSEOF
chmod +x "$ASKPASS_SCRIPT" && SUDO_ASKPASS="$ASKPASS_SCRIPT" brew install --cask basictex 2>&1; EXIT_CODE=$?; rm -f "$ASKPASS_SCRIPT"; exit $EXIT_CODE"#.to_string())
            } else {
                Some("brew install --cask basictex 2>&1".to_string())
            }
        }
        ("texlive", "apt") => {
            if cfg!(target_os = "linux") {
                // Use pkexec for GUI password prompt on Linux
                Some("pkexec apt install -y texlive-latex-base texlive-fonts-recommended texlive-latex-extra 2>&1".to_string())
            } else {
                Some("sudo apt install texlive-latex-base texlive-fonts-recommended texlive-latex-extra 2>&1".to_string())
            }
        }
        ("mermaid-filter", "npm") => {
            if cfg!(target_os = "macos") {
                // Try without sudo first (works if npm prefix is user-writable), fall back to sudo with askpass
                Some(r#"npm install -g mermaid-filter 2>&1 || (ASKPASS_SCRIPT=$(mktemp) && cat > "$ASKPASS_SCRIPT" << 'ASKPASSEOF'
#!/bin/bash
osascript -e 'display dialog "Pandoc GUI needs your password to install mermaid-filter:" default answer "" with hidden answer buttons {"Cancel","OK"} default button "OK"' -e 'text returned of result' 2>/dev/null
ASKPASSEOF
chmod +x "$ASKPASS_SCRIPT" && SUDO_ASKPASS="$ASKPASS_SCRIPT" sudo -A npm install -g mermaid-filter 2>&1; EXIT_CODE=$?; rm -f "$ASKPASS_SCRIPT"; exit $EXIT_CODE)"#.to_string())
            } else if cfg!(target_os = "linux") {
                Some("npm install -g mermaid-filter 2>&1 || pkexec npm install -g mermaid-filter 2>&1".to_string())
            } else {
                Some("npm install -g mermaid-filter 2>&1".to_string())
            }
        }
        ("pandoc-crossref", "brew") => Some("brew install pandoc-crossref 2>&1".to_string()),
        ("pandoc", "brew") => Some("brew install pandoc 2>&1".to_string()),
        _ => None,
    }
}

#[tauri::command]
async fn install_dependency(
    app: AppHandle,
    name: String,
    method: String,
) -> Result<String, String> {
    info!("Installing dependency: {} via {}", name, method);
    let command = get_install_command(&name, &method)
        .ok_or_else(|| format!("Unknown install method {} for {}", method, name))?;
    info!("Install command: {}", command);

    run_command_with_output(app, command, format!("Installing {}", name)).await
}

#[tauri::command]
async fn uninstall_dependency(app: AppHandle, name: String) -> Result<String, String> {
    info!("Uninstalling dependency: {}", name);
    let command =
        get_uninstall_command(&name).ok_or_else(|| format!("Unknown dependency: {}", name))?;
    info!("Uninstall command: {}", command);

    run_command_with_output(app, command, format!("Uninstalling {}", name)).await
}

#[tauri::command]
async fn reinstall_dependency(
    app: AppHandle,
    name: String,
    method: String,
) -> Result<String, String> {
    // First uninstall
    let uninstall_cmd =
        get_uninstall_command(&name).ok_or_else(|| format!("Unknown dependency: {}", name))?;

    let _ =
        run_command_with_output(app.clone(), uninstall_cmd, format!("Uninstalling {}", name)).await;

    // Then install
    let install_cmd = get_install_command(&name, &method)
        .ok_or_else(|| format!("Unknown install method {} for {}", method, name))?;

    run_command_with_output(app, install_cmd, format!("Reinstalling {}", name)).await
}

#[tauri::command]
fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[tauri::command]
fn write_dark_mode_header() -> Result<String, String> {
    use std::io::Write;

    let temp_dir = env::temp_dir();
    let header_path = temp_dir.join("pandoc-dark-mode.tex");

    let header_content = r#"\usepackage{pagecolor}
\usepackage{xcolor}
\definecolor{darkbg}{HTML}{1e1e2e}
\definecolor{lighttext}{HTML}{cdd6f4}
\pagecolor{darkbg}
\color{lighttext}
"#;

    let mut file = std::fs::File::create(&header_path)
        .map_err(|e| format!("Failed to create header file: {}", e))?;

    file.write_all(header_content.as_bytes())
        .map_err(|e| format!("Failed to write header file: {}", e))?;

    Ok(header_path.to_string_lossy().to_string())
}

// Write a header file to fix Unicode box-drawing characters for monospace fonts
#[tauri::command]
fn write_unicode_header() -> Result<String, String> {
    use std::io::Write;

    let temp_dir = env::temp_dir();
    let header_path = temp_dir.join("pandoc-unicode-fix.tex");

    // Use fontspec to set fallback fonts for missing Unicode characters
    // Menlo on macOS has good Unicode coverage including box-drawing chars
    let header_content = r#"\usepackage{fontspec}
\directlua{
  luaotfload.add_fallback("monofallback", {
    "Menlo:mode=harf;",
    "DejaVu Sans Mono:mode=harf;",
    "Apple Symbols:mode=harf;",
  })
}
\setmonofont{Noto Mono}[RawFeature={fallback=monofallback}]
"#;

    let mut file = std::fs::File::create(&header_path)
        .map_err(|e| format!("Failed to create header file: {}", e))?;

    file.write_all(header_content.as_bytes())
        .map_err(|e| format!("Failed to write header file: {}", e))?;

    Ok(header_path.to_string_lossy().to_string())
}

// Generate a reference DOCX with custom fonts and margins
// DOCX is a ZIP archive containing XML files that define styles
#[tauri::command]
fn generate_reference_docx(
    main_font: String,
    mono_font: String,
    font_size: u32,
    margin_top: f64,
    margin_bottom: f64,
    margin_left: f64,
    margin_right: f64,
    margin_unit: String,
) -> Result<String, String> {
    let temp_dir = env::temp_dir();
    let docx_path = temp_dir.join("pandoc-reference.docx");

    // Convert margins to twips (1 inch = 1440 twips, 1 cm = 567 twips, 1 mm = 56.7 twips)
    let twips_per_unit = match margin_unit.as_str() {
        "in" => 1440.0,
        "cm" => 567.0,
        "mm" => 56.7,
        _ => 1440.0, // default to inches
    };

    let margin_top_twips = (margin_top * twips_per_unit) as u32;
    let margin_bottom_twips = (margin_bottom * twips_per_unit) as u32;
    let margin_left_twips = (margin_left * twips_per_unit) as u32;
    let margin_right_twips = (margin_right * twips_per_unit) as u32;

    // Font size in half-points (12pt = 24 half-points)
    let font_size_half_pts = font_size * 2;
    // Heading sizes (relative to body)
    let h1_size = font_size_half_pts + 16; // +8pt
    let h2_size = font_size_half_pts + 12; // +6pt
    let h3_size = font_size_half_pts + 8; // +4pt
    let h4_size = font_size_half_pts + 4; // +2pt

    // Use default fonts if not specified
    let main_font = if main_font.is_empty() {
        "Calibri".to_string()
    } else {
        main_font
    };
    let mono_font = if mono_font.is_empty() {
        "Consolas".to_string()
    } else {
        mono_font
    };

    // Create the DOCX as a ZIP file
    let file = std::fs::File::create(&docx_path)
        .map_err(|e| format!("Failed to create DOCX file: {}", e))?;

    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    // [Content_Types].xml
    let content_types = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
  <Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>
</Types>"#;

    zip.start_file("[Content_Types].xml", options)
        .map_err(|e| format!("Failed to create content types: {}", e))?;
    zip.write_all(content_types.as_bytes())
        .map_err(|e| format!("Failed to write content types: {}", e))?;

    // _rels/.rels
    let rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#;

    zip.start_file("_rels/.rels", options)
        .map_err(|e| format!("Failed to create rels: {}", e))?;
    zip.write_all(rels.as_bytes())
        .map_err(|e| format!("Failed to write rels: {}", e))?;

    // word/_rels/document.xml.rels
    let doc_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>
</Relationships>"#;

    zip.start_file("word/_rels/document.xml.rels", options)
        .map_err(|e| format!("Failed to create doc rels: {}", e))?;
    zip.write_all(doc_rels.as_bytes())
        .map_err(|e| format!("Failed to write doc rels: {}", e))?;

    // word/document.xml - minimal document with page margins
    let document = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t></w:t></w:r></w:p>
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="{}" w:right="{}" w:bottom="{}" w:left="{}" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>"#,
        margin_top_twips, margin_right_twips, margin_bottom_twips, margin_left_twips
    );

    zip.start_file("word/document.xml", options)
        .map_err(|e| format!("Failed to create document.xml: {}", e))?;
    zip.write_all(document.as_bytes())
        .map_err(|e| format!("Failed to write document.xml: {}", e))?;

    // word/styles.xml - defines all text styles with custom fonts
    let styles = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="{main_font}" w:hAnsi="{main_font}" w:eastAsia="{main_font}" w:cs="{main_font}"/>
        <w:sz w:val="{font_size_half_pts}"/>
        <w:szCs w:val="{font_size_half_pts}"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:after="160" w:line="259" w:lineRule="auto"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>

  <!-- Normal style (body text) -->
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
    <w:rPr>
      <w:rFonts w:ascii="{main_font}" w:hAnsi="{main_font}"/>
      <w:sz w:val="{font_size_half_pts}"/>
    </w:rPr>
  </w:style>

  <!-- Heading 1 -->
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:keepLines/>
      <w:spacing w:before="480" w:after="120"/>
      <w:outlineLvl w:val="0"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="{main_font}" w:hAnsi="{main_font}"/>
      <w:b/>
      <w:sz w:val="{h1_size}"/>
    </w:rPr>
  </w:style>

  <!-- Heading 2 -->
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:keepLines/>
      <w:spacing w:before="360" w:after="80"/>
      <w:outlineLvl w:val="1"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="{main_font}" w:hAnsi="{main_font}"/>
      <w:b/>
      <w:sz w:val="{h2_size}"/>
    </w:rPr>
  </w:style>

  <!-- Heading 3 -->
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:keepLines/>
      <w:spacing w:before="280" w:after="80"/>
      <w:outlineLvl w:val="2"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="{main_font}" w:hAnsi="{main_font}"/>
      <w:b/>
      <w:sz w:val="{h3_size}"/>
    </w:rPr>
  </w:style>

  <!-- Heading 4 -->
  <w:style w:type="paragraph" w:styleId="Heading4">
    <w:name w:val="heading 4"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:keepLines/>
      <w:spacing w:before="240" w:after="40"/>
      <w:outlineLvl w:val="3"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="{main_font}" w:hAnsi="{main_font}"/>
      <w:b/>
      <w:sz w:val="{h4_size}"/>
    </w:rPr>
  </w:style>

  <!-- Code/Verbatim style (monospace) -->
  <w:style w:type="character" w:styleId="VerbatimChar">
    <w:name w:val="Verbatim Char"/>
    <w:rPr>
      <w:rFonts w:ascii="{mono_font}" w:hAnsi="{mono_font}"/>
      <w:sz w:val="{font_size_half_pts}"/>
    </w:rPr>
  </w:style>

  <!-- Source Code style (for code blocks) -->
  <w:style w:type="paragraph" w:styleId="SourceCode">
    <w:name w:val="Source Code"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:spacing w:before="100" w:after="100"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="{mono_font}" w:hAnsi="{mono_font}"/>
      <w:sz w:val="{font_size_half_pts}"/>
    </w:rPr>
  </w:style>

  <!-- First Paragraph (no indent) -->
  <w:style w:type="paragraph" w:styleId="FirstParagraph">
    <w:name w:val="First Paragraph"/>
    <w:basedOn w:val="Normal"/>
  </w:style>

  <!-- Body Text -->
  <w:style w:type="paragraph" w:styleId="BodyText">
    <w:name w:val="Body Text"/>
    <w:basedOn w:val="Normal"/>
  </w:style>

</w:styles>"#
    );

    zip.start_file("word/styles.xml", options)
        .map_err(|e| format!("Failed to create styles.xml: {}", e))?;
    zip.write_all(styles.as_bytes())
        .map_err(|e| format!("Failed to write styles.xml: {}", e))?;

    // word/settings.xml - document settings
    let settings = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:zoom w:percent="100"/>
  <w:defaultTabStop w:val="720"/>
</w:settings>"#;

    zip.start_file("word/settings.xml", options)
        .map_err(|e| format!("Failed to create settings.xml: {}", e))?;
    zip.write_all(settings.as_bytes())
        .map_err(|e| format!("Failed to write settings.xml: {}", e))?;

    // word/fontTable.xml - font declarations
    let font_table = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:font w:name="{main_font}">
    <w:charset w:val="00"/>
    <w:family w:val="swiss"/>
  </w:font>
  <w:font w:name="{mono_font}">
    <w:charset w:val="00"/>
    <w:family w:val="modern"/>
    <w:pitch w:val="fixed"/>
  </w:font>
</w:fonts>"#
    );

    zip.start_file("word/fontTable.xml", options)
        .map_err(|e| format!("Failed to create fontTable.xml: {}", e))?;
    zip.write_all(font_table.as_bytes())
        .map_err(|e| format!("Failed to write fontTable.xml: {}", e))?;

    zip.finish()
        .map_err(|e| format!("Failed to finalize DOCX: {}", e))?;

    info!("Generated reference DOCX at: {:?}", docx_path);
    Ok(docx_path.to_string_lossy().to_string())
}

#[tauri::command]
fn list_system_fonts() -> Result<Vec<String>, String> {
    use std::collections::HashSet;

    // Platform-specific font listing
    let output = if cfg!(target_os = "macos") {
        // macOS: Try fc-list first, fall back to atsutil
        Command::new("fc-list")
            .args([":", "family"])
            .output()
            .or_else(|_| {
                // Fallback: use atsutil on macOS (always available)
                Command::new("sh")
                    .args(["-c", "atsutil fonts -list | grep -v '^$' | sort -u"])
                    .output()
            })
    } else if cfg!(target_os = "linux") {
        // Linux: fc-list is standard on most distros
        Command::new("fc-list").args([":", "family"]).output()
    } else if cfg!(target_os = "windows") {
        // Windows: Use PowerShell with proper assembly loading
        Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }"
            ])
            .output()
    } else {
        return Err("Unsupported platform".to_string());
    };

    match output {
        Ok(output) => {
            if output.status.success() {
                let text = decode_command_output(&output.stdout);
                let mut fonts: HashSet<String> = HashSet::new();

                for line in text.lines() {
                    // fc-list may have multiple families separated by commas
                    for part in line.split(',') {
                        let font = part.trim().to_string();
                        // Filter out empty lines, hidden fonts (starting with .), and system prefixes
                        if !font.is_empty()
                            && !font.starts_with('.')
                            && !font.starts_with('#')
                            && font.len() > 1
                        {
                            fonts.insert(font);
                        }
                    }
                }

                let mut result: Vec<String> = fonts.into_iter().collect();
                result.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
                Ok(result)
            } else {
                // Return empty list instead of error - font selection is optional
                Ok(vec![])
            }
        }
        Err(_) => {
            // Return empty list if command fails
            Ok(vec![])
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            // Create custom menu
            let about_item =
                MenuItem::with_id(app, "about", "About Pandoc GUI", true, None::<&str>)?;
            let quit_item = PredefinedMenuItem::quit(app, Some("Quit"))?;
            let separator = PredefinedMenuItem::separator(app)?;

            let app_menu = Submenu::with_items(
                app,
                "Pandoc GUI",
                true,
                &[&about_item, &separator, &quit_item],
            )?;

            let edit_menu = Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, Some("Undo"))?,
                    &PredefinedMenuItem::redo(app, Some("Redo"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, Some("Cut"))?,
                    &PredefinedMenuItem::copy(app, Some("Copy"))?,
                    &PredefinedMenuItem::paste(app, Some("Paste"))?,
                    &PredefinedMenuItem::select_all(app, Some("Select All"))?,
                ],
            )?;

            let menu = Menu::with_items(app, &[&app_menu, &edit_menu])?;
            app.set_menu(menu)?;

            // Handle menu events
            app.on_menu_event(|app_handle, event| {
                if event.id().as_ref() == "about" {
                    // Emit event to frontend to show About modal
                    let _ = app_handle.emit("show-about", ());
                }
            });

            // Enable logging for both debug and release builds
            // Logs go to ~/Library/Logs/Pandoc GUI/ on macOS
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .target(tauri_plugin_log::Target::new(
                        tauri_plugin_log::TargetKind::LogDir {
                            file_name: Some("pandoc-gui.log".into()),
                        },
                    ))
                    .build(),
            )?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            run_pandoc,
            open_file,
            check_command,
            list_system_fonts,
            file_exists,
            write_dark_mode_header,
            write_unicode_header,
            generate_reference_docx,
            install_dependency,
            cancel_all_installs,
            uninstall_dependency,
            reinstall_dependency,
            run_command_with_output,
            get_downloads_path,
            reveal_in_finder,
            get_app_version
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_replace_only_plain_pandoc_commands() {
        assert!(should_replace_pandoc_command("pandoc"));
        assert!(should_replace_pandoc_command("pandoc -t html"));
        assert!(should_replace_pandoc_command("  pandoc \"input.md\""));
        assert!(!should_replace_pandoc_command("xpandoc -t html"));
        assert!(!should_replace_pandoc_command("\"pandoc\" -t html"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn parse_windows_command_line_preserves_quoted_paths() {
        let argv = parse_windows_command_line(
            "\"C:\\Program Files\\Pandoc GUI\\pandoc.exe\" \
             \"C:\\Users\\jian\\Desktop\\AI时代\\输入文档.md\" \
             -t html \
             -o \"C:\\Users\\jian\\Desktop\\输出文档.html\"",
        )
        .expect("command line should parse");

        assert_eq!(argv[0], "C:\\Program Files\\Pandoc GUI\\pandoc.exe");
        assert_eq!(argv[1], "C:\\Users\\jian\\Desktop\\AI时代\\输入文档.md");
        assert_eq!(argv[2], "-t");
        assert_eq!(argv[3], "html");
        assert_eq!(argv[4], "-o");
        assert_eq!(argv[5], "C:\\Users\\jian\\Desktop\\输出文档.html");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn normalize_windows_path_removes_verbatim_prefix() {
        let path = Path::new(r"\\?\C:\Program Files\Pandoc GUI\pandoc.exe");
        assert_eq!(
            normalize_windows_path(path),
            r"C:\Program Files\Pandoc GUI\pandoc.exe"
        );
    }
}
