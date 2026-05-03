/**
 * HealthEventsPage — /health — health-category alias of EventsPage.
 * Thin wrapper so the URL bar / share links / SEO can land on the topic.
 */
import { Heart } from "lucide-react";
import EventsPage from "../EventsPage";

export default function HealthEventsPage() {
  return (
    <EventsPage
      fixedCategory="health"
      pageTitle="Health"
      pageSubtitle="Pandemic signals, FDA decisions, healthcare policy — tracked as live events."
      pageIcon={Heart}
    />
  );
}
