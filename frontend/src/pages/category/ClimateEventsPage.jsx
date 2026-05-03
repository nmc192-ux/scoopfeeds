/**
 * ClimateEventsPage — /climate — climate-category alias of EventsPage.
 * Thin wrapper so the URL bar / share links / SEO can land on the topic.
 */
import { CloudRain } from "lucide-react";
import EventsPage from "../EventsPage";

export default function ClimateEventsPage() {
  return (
    <EventsPage
      fixedCategory="climate"
      pageTitle="Climate"
      pageSubtitle="Extreme weather, emissions policy, climate tipping points — tracked live."
      pageIcon={CloudRain}
    />
  );
}
