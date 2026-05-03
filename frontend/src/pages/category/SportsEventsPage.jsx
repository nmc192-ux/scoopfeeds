/**
 * SportsEventsPage — /sports — sports-category alias of EventsPage.
 * Thin wrapper so the URL bar / share links / SEO can land on the topic.
 */
import { Trophy } from "lucide-react";
import EventsPage from "../EventsPage";

export default function SportsEventsPage() {
  return (
    <EventsPage
      fixedCategory="sports"
      pageTitle="Sports"
      pageSubtitle="Match outcomes, league standings, transfer windows — tracked as live events."
      pageIcon={Trophy}
    />
  );
}
