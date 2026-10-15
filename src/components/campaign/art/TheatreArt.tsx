import IndoorArt from "./IndoorArt";
import type { RoomArtProps } from "./kit";

/** STUB: the art for event-theatre is being written. It borrows the indoor party's until then. */
export default function TheatreArt(props: RoomArtProps) {
  return <IndoorArt {...props} />;
}
