import IndoorArt from "./IndoorArt";
import type { RoomArtProps } from "./kit";

/** STUB: the art for event-outdoor is being written. It borrows the indoor party's until then. */
export default function OutdoorArt(props: RoomArtProps) {
  return <IndoorArt {...props} />;
}
