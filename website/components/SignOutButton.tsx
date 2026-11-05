"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";

export function SignOutButton() {
  return (
    <button onClick={() => signOut({ callbackUrl: "/" })} className="inline-flex items-center gap-1.5 text-[13px] text-faint hover:text-ink" data-testid="signout">
      <LogOut size={14} /> Sign out
    </button>
  );
}
