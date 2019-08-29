// Page state
var app = new $.Machine({
  map: null,
  mapElement: $('#map')[0],
  destination: { latitude: null, longitude: null },
  marker: null,
  hasCamera: true,
  video: $('video')[0],
  photoCanvas: null,
  photoContext: null,
  iv: 0,
  heartbeat: false,
  geoIv: 0,
  geo: { latitude: null, longitude: null }
});

// Events
$.targets({

  load () {
    app.emit('init');
  },

  resize () {
    app.emit('resize');
    ar.emit('resize')
  },

  deviceorientation (e) {
    var alpha;
    if (e.webkitCompassHeading) alpha = e.webkitCompassHeading;
    else {
      alpha = e.alpha;
      // if (!window.chrome) alpha += 270
    }
    let { beta, gamma } = e;
    ar.state().rotationObservers.forEach(ofn => ofn({alpha, beta, gamma}))
  },

  app: {

    init () {
      this.map = initMap();
      let photoCanvas = this.photoCanvas = document.createElement('canvas');
      this.photoContext = photoCanvas.getContext('2d');
      app.emit('resize');
      for (let c of 'Where do you want to go today?')
        $.pipe('title', () => new Promise(r => setTimeout(() => r($('#title')[0].textContent += c), 50)))
    },

    chooseDest () {
      let body = new FormData(),
          [ longitude, latitude ] = ol.proj.toLonLat(app.state().map.getView().getCenter()),
          destination = this.destination = { latitude, longitude };
      body.append('timestamp', Date.now());
      body.append('geo', JSON.stringify({ destination }));
      return app.emitAsync('startCamera')
        .then(() => ar.emitAsync('init'))
        .catch(e => {
          console.log(e);
          this.hasCamera = false;
          $('#displayToggle')[0].classList.add('hide');
          $('.feedback').forEach(el => el.classList.toggle('active'))
        })
        .then(() => app.emitAsync('showDest'))
        .catch(e => {
          app.emit('debug', e.message)
          console.log(e)
        })
    },

    setMarker (lat, lng) {
      this.marker = new ol.Feature({
        geometry: new ol.geom.Point(
          ol.proj.fromLonLat([lng, lat])
        )
      });
      let vectorSource = new ol.source.Vector({ features: [this.marker] }),
          markerVectorLayer = new ol.layer.Vector({ source: vectorSource });
      this.map.addLayer(markerVectorLayer)
    },

    setZoom () {
      let { latitude } = this.destination,
          vmin = Math.min(document.body.clientHeight, document.body.clientWidth) / 2;
      let { distance } = app.distanceBearingFromLatLng();
      this.map.getView().setZoom(getZoomLevel(latitude, distance, vmin));
    },

    showDest () {
      let {latitude, longitude} = this.destination;
      $('#destMap')[0].append(this.mapElement.childNodes[0])
      this.mapElement = $('#destMap')[0];
      //this.map.
      //this.map = initMap(null);
      app.emit('setMarker', latitude, longitude);

      $('section').forEach(el => el.classList.toggle('active'));

      this.geoIv = navigator.geolocation.watchPosition(
        pos => app.emit('updateGeo', pos),
        console.log,
        { enableHighAccuracy: true }
      );
    },

    heartbeat (on) {
      this.heartbeat = on ?
        this.iv = setTimeout(() => $.pipe('heartbeat',
          () => app.emitAsync('sendData'),
          () => app.emitAsync('heartbeat', this.heartbeat)), 1000) :
        clearTimeout(this.iv)
    },

    sendData () {
      let body = new FormData();
      body.append('timestamp', Date.now());
      body.append('geo', JSON.stringify({ update: this.geo }));
      if (this.hasCamera && $('.feedback.active')[0].id === 'ar' && false) {
        let { width, height } = this.photoCanvas;
        this.photoContext.drawImage(this.video, 0, 0, width, height);
        let { data } = this.photoContext.getImageData(0, 0, width, height);
        body.append('imgbuf', new Blob([data]), 'imgbuf');
      }
      //return fetch('/', {method: 'POST', body})
    },


    // Camera image

    resize () { // Change image resolution here
      let { clientWidth, clientHeight } = document.body;
      this.photoCanvas.width = clientWidth / 4;
      this.photoCanvas.height = clientHeight / 4;
      $('canvas')[0].width = this.video.width = clientWidth;
      $('canvas')[0].height = this.video.height = clientHeight
    },


    // Geolocation

    updateGeo (pos) {
      let { latitude, longitude } = pos.coords;
      this.geo = { latitude, longitude };
      let olGeo = ol.proj.fromLonLat([longitude, latitude]);
      this.map.getView().setCenter(olGeo);
      app.emit('setZoom');
      app.emit('sendData')
    },


    // Camera
    startCamera () {
      if (navigator.mediaDevices.getUserMedia) {
        return navigator.mediaDevices.getUserMedia({
          video: { width: 4800, height: 6400/*, facingMode: { exact: 'environment' }*/ }
        }).then(s => {
          this.video.srcObject = s;
          this.video.onloadedmetadata = () => this.video.play();
        })
      } else throw new Error('Can\'t connect camera')
    },


    // Debug
    debug (...strings) { $('#debug')[0].textContent = strings.join(' ') }

  }
});

$.queries({
  '#map': {
    'mousedown touchstart' () { $.pipe('titleblur', () => new Promise(r => setTimeout(() => r($('.padded-multiline')[0].classList.add('blur')), 500))) },
    'mouseup touchend' () { $.pipe('titleblur', () => new Promise(r => setTimeout(() => r($('.padded-multiline')[0].classList.remove('blur')), 500))) }
  },
  '#title': {
    click () {
      app.emit('chooseDest')
    }
  },
  '#displayToggle': {
    click () {
      $('.feedback').forEach(el => el.classList.toggle('active'))
      this.textContent = $('.feedback.active')[0].id === 'ar' ? 'Show map' : 'Show AR'
    }
  }
});

function initMap (interaction = ol.interaction.defaults()) {
  return new ol.Map({
    target: app.state().mapElement,
    layers: [
      new ol.layer.Tile({
        source: new ol.source.OSM()
      })
    ],
    view: new ol.View({
      center: ol.proj.fromLonLat([153.013302, -27.497561]),
      zoom: 16
    }),
    interaction: null
  })
}

function getZoomLevel (lat, distance, vmin) {
  let raw = Math.log(vmin * 156543.03392 * Math.cos(lat * Math.PI / 180) / distance) / Math.LN2;
  return Math.max(Math.min(Math.floor(raw), 20), 1)
}

app.distanceBearingFromLatLng = function (degLat1, degLon1, degLat2, degLon2) {
  if (arguments.length === 0) {
    degLat1 = this.state().geo.latitude;
    degLon1 = this.state().geo.longitude;
    degLat2 = this.state().destination.latitude;
    degLon2 = this.state().destination.longitude;
  }
  function toRadians(degrees) {
    return degrees * (Math.PI/180)
  }
  function toDegrees(radians) {
    return radians * 180 / Math.PI;
  }
  var R = 6371000,
      lat1 = toRadians(degLat1),
      lon1 = toRadians(degLon1),
      lat2 = toRadians(degLat2),
      lon2 = toRadians(degLon2),
      dLat = lat2 - lat1,
      dLon = lon2 - lon1,
      a = Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1) * Math.cos(lat2) *
        Math.sin(dLon/2) * Math.sin(dLon/2),
      c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)),
      y = Math.sin(dLon) * Math.cos(lat2),
      x = Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return { distance: R * c, bearing: (toDegrees(Math.atan2(y, x)) + 360) % 360 };
}

function compassHeading( alpha, beta, gamma ) {
  var degtorad = Math.PI / 180; // Degree-to-Radian conversion

  var _x = beta  ? beta  * degtorad : 0; // beta value
  var _y = gamma ? gamma * degtorad : 0; // gamma value
  var _z = alpha ? alpha * degtorad : 0; // alpha value

  var cX = Math.cos( _x );
  var cY = Math.cos( _y );
  var cZ = Math.cos( _z );
  var sX = Math.sin( _x );
  var sY = Math.sin( _y );
  var sZ = Math.sin( _z );

  // Calculate Vx and Vy components
  var Vx = - cZ * sY - sZ * sX * cY;
  var Vy = - sZ * sY + cZ * sX * cY;

  // Calculate compass heading
  var compassHeading = Math.atan( Vx / Vy );

  // Convert compass heading to use whole unit circle
  if( Vy < 0 ) {
    compassHeading += Math.PI;
  } else if( Vx < 0 ) {
    compassHeading += 2 * Math.PI;
  }

  return compassHeading * ( 180 / Math.PI ); // Compass Heading (in degrees)

}


// AR
var ar = new $.Machine({
  arCanvas: $('#arGUI')[0],
  renderer: null,
  camera: null,
  scene: null,
  geom: new THREE.BoxGeometry(1, 1, 1),
  material: null,
  object: null,

  rotationObservers: [],
  obsFlag: false,
  pause: null
});

let startTime = Date.now()

$.targets({
  ar: { // TODO: pause while in map mode

    init () {
      let width = window.innerWidth,
          height = window.innerHeight;

      this.scene = new THREE.Scene();
      this.renderer = new THREE.WebGLRenderer({canvas: this.arCanvas, antialias: true, alpha: true});
      this.camera = new THREE.PerspectiveCamera(60, width / height, .01, 1000);
      ar.emit('resize');
      this.scene.add(this.camera);
      this.renderer.domElement.id = "renderer";

      let pointLight = new THREE.PointLight(0xffffff);
      //Object.assign(pointLight.position, {x:6,y:5,z:17});
      pointLight.position.x = 6
      pointLight.position.y = 5
      pointLight.position.z = 17
      this.scene.add(pointLight);

      ar.emit('updateMaterial');
      return ar.emitAsync('buildObject', 'model100').then(() => ar.emitAsync('createObject'))
        .then(() => ar.emit('unpause'))
        .catch(console.log)
      // ar.emitAsync('createObject')
      //   .then(() => ar.emit('unpause'))
    },

    resize () {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix()
    },

    updateMaterial () {
      this.material = new THREE.MeshNormalMaterial({
        transparent: true, opacity: .5
      });
      this.material.side = THREE.DoubleSide
    },

    createObject () {
      let { geom, material, scene, object } = this,
          objnew = new THREE.Mesh(geom, material),

          { distance, bearing } = app.distanceBearingFromLatLng();
      objnew.rotation.set(0, 0, 0);
      console.log(scene)
      if (object) {
        objnew.rotation = object.rotation;
        objnew.scale = object.scale;
        scene.remove(object)
      }
      // app.emit('debug', distance)
      objnew.position.x = 5 * Math.cos(bearing);
      objnew.position.y = 5 * Math.sin(bearing);
      scene.add(objnew);
      this.object = objnew
    },

    animate ({alpha, beta, gamma}, fromObs) {
      this.camera.rotation.y = alpha * Math.PI / 180;
      this.camera.rotation.x = beta * Math.PI / 180;

      // function toRadians(degrees) {
      //   return degrees * (Math.PI/180)
      // }

      // var quaternion = new THREE.Quaternion().setFromEuler(
      //   new THREE.Euler(toRadians(beta), toRadians(alpha), 0));
      // this.camera.setRotationFromQuaternion(quaternion);

			this.object.rotation.x += 0.02 * .2;
			this.object.rotation.y += 0.0225 * .2;
			this.object.rotation.z += 0.0175 * .2;
				// make the cube bounce
			var dtime	= Date.now() - startTime;
			this.object.scale.x	= 1 + 0.3*Math.sin(dtime/300);
			this.object.scale.y	= 1 + 0.3*Math.sin(dtime/300);
			this.object.scale.z	= 1 + 0.3*Math.sin(dtime/300);


      this.renderer.render(this.scene, this.camera);
      if (!this.pause && !this.obsFlag) requestAnimationFrame(() => ar.emit('animate', {alpha, beta, gamma}, false));
      this.obsFlag = fromObs
    },

    pause () { this.pause = true },
    unpause () {
      this.pause = false;
      this.rotationObservers.push(({alpha, beta, gamma}) =>
        ar.emit('animate', {alpha, beta, gamma}, true))
      ar.emit('animate', {}, false)
    },

    buildObject (name) {
      return new Promise(r => new THREE.GLTFLoader().load(
      	// resource URL
      	`${name}.glb`,
      	// called when the resource is loaded
      	function ( glb ) {
          console.log(glb)
          this.scene = glb.scene
          r()
      		// scene.add( gltf.scene );
          //
      		// gltf.animations; // Array<THREE.AnimationClip>
      		// gltf.scene; // THREE.Scene
      		// gltf.scenes; // Array<THREE.Scene>
      		// gltf.cameras; // Array<THREE.Camera>
      		// gltf.asset; // Object

      	},
      	// called while loading is progressing
      	function ( xhr ) {

      		console.log( ( xhr.loaded / xhr.total * 100 ) + '% loaded' );

      	},
      	// called when loading has errors
      	function ( error ) {

      		console.log( 'An error happened', error );

      	}
      ))
    }

  }
})
