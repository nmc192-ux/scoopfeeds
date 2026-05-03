/**
 * CryptoEventsPage — /crypto — crypto-category alias of EventsPage.
 * Thin wrapper so the URL bar / share links / SEO can land on the topic.
 */
import { Bitcoin } from "lucide-react";
import EventsPage from "../EventsPage";

export default function CryptoEventsPage() {
  return (
    <EventsPage
      fixedCategory="crypto"
      pageTitle="Crypto"
      pageSubtitle="Token moves, protocol launches, regulatory shifts — tracked as live events."
      pageIcon={Bitcoin}
    />
  );
}
