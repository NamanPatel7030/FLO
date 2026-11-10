// The floating helper shown over System Settings while the person turns on Accessibility: a
// System Settings-style row ("Flo" + a switch) whose switch flips on in a loop, so it's obvious
// which one to click. The backend closes it the moment the grant lands. Tiny on purpose (own chunk).
import { X } from "lucide-react";
import { api } from "../lib/api";
import { LogoMark } from "../dashboard/Logo";

const css = `
@keyframes pg-knob { 0%, 35% { transform: translateX(0) } 55%, 100% { transform: translateX(16px) } }
@keyframes pg-track { 0%, 35% { background: #d4d7de } 55%, 100% { background: #2f8cff } }
@keyframes pg-hand { 0%, 20% { transform: translate(14px, 12px); opacity: 0 } 30% { opacity: 1 } 42% { transform: translate(0, 0) scale(1) }
  48% { transform: translate(0, 0) scale(0.86) } 56% { transform: translate(0, 0) scale(1) } 85% { opacity: 1 } 100% { transform: translate(0, 0); opacity: 0 } }
@keyframes pg-in { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
.pg-knob { animation: pg-knob 2.4s ease-in-out infinite }
.pg-track { animation: pg-track 2.4s ease-in-out infinite }
.pg-hand { animation: pg-hand 2.4s ease-in-out infinite }
.pg-card { animation: pg-in .35s ease-out both }
@media (prefers-reduced-motion: reduce) { .pg-knob, .pg-track, .pg-hand { animation: none } .pg-knob { transform: translateX(16px) } .pg-track { background: #2f8cff } }
`;

export default function PermGuide() {
  return (
    <div className="flex h-screen w-screen items-end justify-center p-2" data-tauri-drag-region>
      <style>{css}</style>
      <div
        className="pg-card relative flex w-full items-center gap-4 rounded-[18px] border border-black/10 bg-white/95 px-4 py-3.5 text-[#0b1220] shadow-[0_18px_40px_-14px_rgb(11_18_32/0.45)] backdrop-blur"
        data-testid="perm-guide"
        data-tauri-drag-region
      >
        <div className="min-w-0 flex-1" data-tauri-drag-region>
          <div className="text-[13.5px] font-semibold">Turn on Flo in the list above</div>
          <div className="mt-0.5 text-[12px] text-[#5b6678]">Privacy &amp; Security, Accessibility. I'll take it from there.</div>
          {/* a System Settings-style row with the switch to flip */}
          <div className="mt-2.5 flex items-center gap-2.5 rounded-[10px] bg-[#f2f4f8] px-2.5 py-1.5">
            <LogoMark size={20} />
            <span className="flex-1 text-[13px] font-medium">Flo</span>
            <span className="relative">
              <span className="pg-track flex h-[20px] w-[36px] items-center rounded-full px-[2px]">
                <span className="pg-knob h-[16px] w-[16px] rounded-full bg-white shadow" />
              </span>
              <span className="pg-hand pointer-events-none absolute -bottom-3 left-5 text-[18px]" aria-hidden>
                👆
              </span>
            </span>
          </div>
        </div>
        <button
          className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-[#8a94a6] hover:bg-black/5 hover:text-[#0b1220]"
          aria-label="Close"
          onClick={() => api.closePermissionGuide().catch(() => {})}
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
