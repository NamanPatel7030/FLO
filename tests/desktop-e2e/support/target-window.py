#!/usr/bin/env python3
"""A plain text window for the dictation test (Linux): what is typed or pasted into it is written to
argv[1] several times a second, so the test can read what Flo inserted."""
import sys
import tkinter as tk

out = sys.argv[1]
root = tk.Tk()
root.title("Flo E2E target")
root.geometry("640x240+80+320")
text = tk.Text(root, font=("DejaVu Sans", 14))
text.pack(fill="both", expand=True)
text.focus_force()


def dump():
    with open(out, "w") as f:
        f.write(text.get("1.0", "end-1c"))
    root.after(200, dump)


root.after(300, lambda: (root.focus_force(), text.focus_set()))
dump()
root.mainloop()
