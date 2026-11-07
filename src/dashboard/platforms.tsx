// Built-in platforms a skill can target (custom ones are added in Skills → Connections).
import { Briefcase, Globe, Mail, MessageSquare, MonitorSmartphone, Users } from "lucide-react";

export const PLATFORMS: { id: string; label: string; icon: React.ReactNode }[] = [
  { id: "upwork", label: "Upwork", icon: <Briefcase size={13} /> },
  { id: "slack", label: "Slack", icon: <MessageSquare size={13} /> },
  { id: "gmail", label: "Gmail", icon: <Mail size={13} /> },
  { id: "linkedin", label: "LinkedIn", icon: <Users size={13} /> },
  { id: "whatsapp", label: "WhatsApp", icon: <MessageSquare size={13} /> },
  { id: "browser", label: "Any website", icon: <Globe size={13} /> },
  { id: "any", label: "Any app", icon: <MonitorSmartphone size={13} /> },
];
