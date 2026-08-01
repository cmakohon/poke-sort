import { useEffect, useState } from "react";

export function useIsMobile(breakpoint = 767): boolean {
	// Computed synchronously (not defaulted to false) so the very first render
	// already reflects the real device - callers that gate side effects like
	// camera/permission requests on this value can't race a "desktop" flash.
	const [isMobile, setIsMobile] = useState(
		() => window.matchMedia(`(max-width: ${breakpoint}px)`).matches,
	);

	useEffect(() => {
		const mql = window.matchMedia(`(max-width: ${breakpoint}px)`);
		setIsMobile(mql.matches);

		const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
		mql.addEventListener("change", handler);
		return () => mql.removeEventListener("change", handler);
	}, [breakpoint]);

	return isMobile;
}
