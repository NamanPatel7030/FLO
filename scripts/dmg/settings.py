# dmgbuild settings for Flo's installer window. Used by scripts/make-dmg.sh.
# `app` is passed in with -D app=/path/to/Flo.app.
import os.path

app = defines.get("app", "src-tauri/target/release/bundle/macos/Flo.app")  # noqa: F821
appname = os.path.basename(app)

format = "UDZO"
filesystem = "HFS+"
files = [app]
symlinks = {"Applications": "/Applications"}
icon_locations = {appname: (210, 240), "Applications": (550, 240)}
background = defines.get("background", "scripts/dmg/background.tiff")  # noqa: F821

# the height includes the title bar, so add it to the 480 px background
window_rect = ((200, 120), (760, 513))
default_view = "icon-view"
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
icon_size = 128
text_size = 12
arrange_by = None
include_icon_view_settings = True
