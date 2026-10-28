use std::fs;
use std::path::Path;

// The frontend lives at the repository root. Copy it into dist/ so the Tauri
// build embeds exactly the files being edited, not a stale duplicate.
fn main() {
    let root = Path::new("..");
    let dist = root.join("dist");
    let dist_js = dist.join("js");
    fs::create_dir_all(&dist_js).expect("create dist/js");

    for name in ["index.html", "styles.css"] {
        fs::copy(root.join(name), dist.join(name))
            .unwrap_or_else(|e| panic!("copy {name}: {e}"));
    }
    for entry in fs::read_dir(root.join("js")).expect("read js folder") {
        let path = entry.expect("js entry").path();
        if path.extension().and_then(|s| s.to_str()) == Some("js") {
            let name = path.file_name().expect("js file name");
            fs::copy(&path, dist_js.join(name)).expect("copy js file");
        }
    }

    println!("cargo:rerun-if-changed=../index.html");
    println!("cargo:rerun-if-changed=../styles.css");
    println!("cargo:rerun-if-changed=../js");

    tauri_build::build()
}
