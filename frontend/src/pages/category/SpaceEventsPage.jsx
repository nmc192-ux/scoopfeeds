/**
 * SpaceEventsPage — /space — space-category alias of EventsPage.
 * Thin wrapper so the URL bar / share links / SEO can land on the topic.
 */
import { Rocket } from "lucide-react";
import EventsPage from "../EventsPage";

export default function SpaceEventsPage() {
  return (
    <EventsPage
      fixedCategory="space"
      pageTitle="Space"
      pageSubtitle="Launches, missions, planetary discoveries — tracked as live events."
      pageIcon={Rocket}
    />
  );
}
