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
      //extended: 1
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
    //data.items = [data.items[0], data.items[1], data.items[2], data.items[3]]; // for debug purposes
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
  var clusterLayout = ymaps.templateLayoutFactory.createClass(
    '<div class="photoIcon cluster" style="background-image: url(\'{{ properties.iconSrc }}\');">\
      <div>{% if properties.geoObjects.length > 999 %}999+{% else %}{{ properties.geoObjects.length }}{% endif %}</div>\
    </div>', {
      build: function () {
        this.getData().properties.set('iconSrc', this.getData().properties.get('geoObjects')[0].options.get('iconSrc'));
        this.constructor.superclass.build.call(this);
      }
    }
  );

  var clusterBalloonLayout = ymaps.templateLayoutFactory.createClass(
    '<div class="clusterBalloon">{{ properties.balloonHtml|raw }}</div>', {
      build: function () {
        var geoObjects = this.getData().properties.get('geoObjects');
        var rows = [];
        var row = [];
        var curWidth = 0;
        var curHeight = 0;
        var rowWidth = 400;
        var rowMaxHeight = 60;
        var html = [];
        for (var i = 0; i < geoObjects.length; i++) {
          var photo = geoObjects[i].options.get('photo');
          var w = photo.width || 100;
          var h = photo.height || 100;
          if (row.length == 0) {
            curHeight = h;
          }

          row.push({ src: photo.photo_130, width: w, height: h, unknown: !!photo.width });

          var scaledWidth = w * (curHeight / h) + 2;
          curWidth += scaledWidth;

          var rowHeight = curHeight * (rowWidth / curWidth);
          if ((rowHeight <= rowMaxHeight) || (i == geoObjects.length - 1)) {
            rowHeight = Math.min(rowHeight, rowMaxHeight);

            rows.push(row);
            html.push('<div class="row">');
            curWidth = 0;
            for (var j = 0; j < row.length; j++) {
              row[j].width *= rowHeight / row[j].height;
              row[j].height = rowHeight;

              if ((i < geoObjects.length - 1) && (j == row.length - 1)) {
                row[j].width = rowWidth - curWidth;
              }

              html.push('<img style="width: ' + Math.round(row[j].width) + 'px; height: ' + Math.round(row[j].height) + 'px;" src="' + row[j].src + '"/>');
              curWidth += Math.round(row[j].width) + 2;
            }
            html.push('</div>');

            curWidth = 0;
            curHeight = 0;
            row = [];
          }
        }

        this.e = document.createElement('div');
        this.e.className = 'clusterBalloon';
        this.e.innerHTML = html.join('');
        this.getParentElement().appendChild(this.e);
      },
      clear: function() {
        if (this.e) {
          this.getParentElement().removeChild(this.e);
          this.e = false;
        }
      },
      destroy: function() {
        this.clear();
      },
      rebuild: function() {
        this.clear();
        this.build();
      }
    }
  );

  var iconLayoutBig = ymaps.templateLayoutFactory.createClass(
    '<div class="photoIcon" style="background-image: url(\'{{ options.src }}\');"></div>'
  );
  var iconLayoutSmall = ymaps.templateLayoutFactory.createClass(
    '<div class="photoIcon small" style="background-image: url(\'{{ options.src }}\');"></div>'
  );

  var clusterer = new ymaps.Clusterer({
    margin: 23,
    gridSize: 32,
    minClusterSize: 5,
    clusterIconLayout: clusterLayout,
    clusterIconShape: {
      type: 'Rectangle',
      coordinates: [
        [-22, -22], [22, 22]
      ]
    },
    //clusterBalloonCloseButton: false,
    clusterBalloonMinWidth: 420,
    clusterBalloonMaxWidth: 420,
    clusterBalloonMaxHeight: 300,
    clusterBalloonContentLayout: clusterBalloonLayout,
    clusterDisableClickZoom: true
  });
  clusterer.add(photos.map(function(photo) {
    var isBig = false; // photo.likes.count > 20
    return photo.placemark = new ymaps.Placemark ([photo.lat, photo.long], {
      balloonContentHeader: photo.id,
      balloonContent: '<a target="_blank" href="' + photo.url + '"><img src="' + photo.photo_130 + '"></a>',
    }, {
      photo: photo,
      iconLayout: isBig ? iconLayoutBig : iconLayoutSmall,
      iconSrc: photo.photo_75,
      iconShape: {
        type: 'Rectangle',
        coordinates: isBig ? [
          [-22, -22], [22, 22]
        ] : [
          [-11, -11], [11, 11]
        ]
      }
    });
  }));
  map.geoObjects.add(clusterer);
  $('#counters').hide();
}
