/** Answer the client card with the current staging progress. */
export function createStatusHandler(connection, status) {
	return (req, res) => {
		const rejection = connection.requestRejection(req);
		if (rejection !== undefined) {
			res.writeHead(rejection, {
				'content-type': 'application/json; charset=utf-8',
				'cache-control': 'no-store',
			});
			res.end(JSON.stringify({ error: rejection === 401 ? 'authentication required' : 'forbidden' }));
			return;
		}
		res.writeHead(200, {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': 'no-store',
		});
		res.end(JSON.stringify(status.snapshot()));
	};
}
