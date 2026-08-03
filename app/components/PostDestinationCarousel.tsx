"use client";

import { useInfiniteHorizontalScroll } from "./useInfiniteHorizontalScroll";
import DestinationCard from "./DestinationCard";
import type { SearchDestination } from "../page";

type PostDestinationCarouselProps = {
  items: SearchDestination[];
  isSearching: boolean;
  isSelected: (item: SearchDestination) => boolean;
  onSelect: (item: SearchDestination) => void;
};

// Country/region picker for the post-creation wizard's destination step — same
// infinite-scroll carousel mechanic as the hero search's DestinationPickerOverlay.
export default function PostDestinationCarousel({
  items,
  isSearching,
  isSelected,
  onSelect,
}: PostDestinationCarouselProps) {
  const { scrollerRef, displayItems, handleScroll } = useInfiniteHorizontalScroll(items, !isSearching);

  return (
    <div
      ref={scrollerRef}
      onScroll={handleScroll}
      className="flex snap-x snap-mandatory gap-4 overflow-x-auto px-[calc(50%-3rem)] py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {displayItems.map((d, i) => (
        <DestinationCard
          key={`${d.type}:${d.type === "country" ? d.code : d.name}:${i}`}
          dest={d}
          selected={isSelected(d)}
          onSelect={() => onSelect(d)}
        />
      ))}
    </div>
  );
}
