/**
 * AIEventsPage — /ai — ai-category alias of EventsPage.
 * Thin wrapper so the URL bar / share links / SEO can land on the topic.
 */
import { Cpu } from "lucide-react";
import EventsPage from "../EventsPage";

export default function AIEventsPage() {
  return (
    <EventsPage
      fixedCategory="ai"
      pageTitle="AI"
      pageSubtitle="Model launches, capability shifts, AI policy — tracked as live events."
      pageIcon={Cpu}
    />
  );
}
