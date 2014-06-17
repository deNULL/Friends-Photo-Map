var VK = {
	api: function(method, params) {
		if (!method) {
			return;
		}
		var url = "https://api.vk.com/method/" + method;
		params = params || {};
		params.v = params.v || '5.21';
		return $.get(url, params, null, 'jsonp').fail(function() {
			console.log(arguments);
		}).then(function(data) {
			var resp = $.Deferred();
			return data.response ?
			resp.resolve(data.response) :
			resp.reject(data.error);
		});
	},
	userAlbums: function(user) {
		var method = 'photos.getAlbums',
		params = {
			owner_id: user.id || user,
			need_system: 1
		};
		return VK.api(method, params);
	},
	albumPhotos: function(album, offset) {
		var method = 'photos.get',
		params = {
			owner_id: album.owner_id,
			album_id: album.id,
			offset: offset || 0,
			extended: 1
		};
		return VK.api(method, params);
	},
	userFriends: function(user) {
		var method = 'friends.get',
		params = {
			user_id: user.id || user
		};
		return VK.api(method, params);
	},
	getId: function(nick) {
		var method = 'utils.resolveScreenName',
			params = {screen_name: nick};
		return VK.api(method, params);
	},
	parseLink: function(link) {
		var regex = /^(?:(https?):\/\/)vk.com\/(app\d+|[a-z0-9_\.]*)/
		return link.match.slice(1);
	}
}

var count = {
	friends: [0, 0],
	albums: [0, 0],
	photos: [0]
};


function updateCount() {
	$(".counter").each(function() {
		var c = count[this.id];
		if (!c[1] && c[0] || c[0] < c[1]) {
			$(this).text(c.join('/')).
			parent().show();
		} else {
			$(this).parent().hide();
		}
	});
}

function mergeDeferreds(array) {
	var l = array.length;
	return l > 1 ? $.when.apply($, array).then(function() {
		var photos = [],
		errors = [];
		for (var i = 0; i < l; i++) {
			$.merge(photos, arguments[i][0]);
			$.merge(errors, arguments[i][1]);
		}
		return $.Deferred().resolve(photos, errors);
	}) : array[0];
}

function findPhotos(user) {
	user = parseInt(user) || VK.getUserId;
	return $.when(user).then(VK.userFriends).then(function(data) {
		count.friends[1] += data.count;
		updateCount();
		var friendPromises = data.items.map(function(user) {
			return VK.userAlbums(user).always(function() {
				count.friends[0]++;
				updateCount();
			}).then(function(data) {
				count.albums[1] += data.count;
				updateCount();
				var albumPromises = data.items.map(function(album) {
					var s = album.size,
					bundlePromises = s ? [] : [$.Deferred().resolve([], [{
						error: 'album is empty',
						owner_id: album.owner_id,
						album_id: album.id
					}])];
					for (var offset = 0; offset < s; offset += 1000) {
						bundlePromises.push(VK.albumPhotos(album, offset).then(function(data) {
							var photos = data.items.filter(function(photo) {
								return !!photo.lat;
							});
							photos.forEach(function(photo) {
								photo.url = 'https://vk.com/photo' + photo.owner_id + "_" + photo.id;
							});
							count.photos[0] += photos.length;
							updateCount();
							return $.Deferred().resolve(photos,[]);
						}, function(error) {
							return $.Deferred().resolve([], [error]);
						}));
					}
					return mergeDeferreds(bundlePromises).done(function() {
						count.albums[0]++;
						updateCount();
					});
				});
				return mergeDeferreds(albumPromises);
			}, function(error) {
				return $.Deferred().resolve([], [error]);
			});
		});
		return mergeDeferreds(friendPromises);
	}, function(error) {
		return $.Deferred().resolve([], [error]);
	});
}

function createMap() {
	var map = new ymaps.Map("map", {
		center: [60, 30],
		zoom: 7
	});
	return map;
}

function addPhotos(photos, map) {
	var iconLayoutBig = ymaps.templateLayoutFactory.createClass(
    '<div style="\
    	width: 40px;\
    	height: 40px;\
    	background: url(\'{{ options.src }}\');\
    	background-size: contain;\
    	outline: 1px solid rgba(0, 0, 0, 0.1);\
    	border: 2px solid #FFF;\
    	box-shadow: 1px 1px 1px rgba(0, 0, 0, 0.3);">\
    </div>'
	);
	var iconLayoutSmall = ymaps.templateLayoutFactory.createClass(
    '<div style="\
    	width: 12px;\
    	height: 12px;\
    	background: url(\'{{ options.src }}\');\
    	background-size: contain;\
    	outline: 1px solid rgba(0, 0, 0, 0.1);\
    	border: 1px solid #FFF;">\
    </div>'
	);

	var clusterer = new ymaps.Clusterer();
	clusterer.add(photos.map(function(photo) {
		return photo.placemark = new ymaps.Placemark ([photo.lat, photo.long], {
			balloonContentHeader: photo.id,
			balloonContent: '<a target="_blank" href="' + photo.url + '"><img src="' + photo.photo_130 + '"></a>'
		}, {
			iconLayout: photo.likes.count > 10 ? iconLayoutBig : iconLayoutSmall,
			iconSrc: photo.photo_75,
		});
	}));
	map.geoObjects.add(clusterer);
	$('#counters').hide();
}
