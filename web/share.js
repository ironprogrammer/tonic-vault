// On a phone the share sheet can AirDrop or message the file; elsewhere it downloads.
export const SHARES = matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [new File([], 'x.mid', { type: 'audio/midi' })] });
export const SHARE_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M8 10V2M5 4.5 8 2l3 2.5M5.5 7H3.5v6.5h9V7h-2"/></svg>';

// Falls back to a download if sharing fails for any reason but the user closing the sheet.
export function sendFile(file) {
	if (!SHARES) return download(file);
	navigator.share({ files: [file] }).catch((e) => {
		if (e.name === 'AbortError') return;
		console.error(e);
		download(file);
	});
}

function download(file) {
	const a = document.createElement('a');
	a.href = URL.createObjectURL(file);
	a.download = file.name;
	a.click();
	URL.revokeObjectURL(a.href);
}
