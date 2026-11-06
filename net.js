/* Telefonlar arası bağlantı.
   Ücretsiz, hesapsız, herkese açık MQTT sunucuları üzerinden mesajlaşır.
   Oyun durumu kurucunun telefonunda tutulur; diğerleri sadece hamle gönderir. */
(function () {
  'use strict';
  var BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://test.mosquitto.org:8081/mqtt'
  ];
  var PREFIX = 'bilgicemberi/v1/';

  // Test için: ?local=1 ile aynı tarayıcıdaki sekmeler arasında çalışır
  function LocalTransport() {
    var handlers = {}, chans = {};
    function chan(topic) {
      if (!chans[topic]) {
        chans[topic] = new BroadcastChannel('bc:' + topic);
        chans[topic].onmessage = function (e) { (handlers[topic] || []).forEach(function (h) { h(e.data); }); };
      }
      return chans[topic];
    }
    return {
      ready: Promise.resolve(),
      onStatus: function () {},
      publish: function (topic, obj, retain) {
        var s = JSON.stringify(obj);
        if (retain) localStorage.setItem('bc:retain:' + topic, s);
        chan(topic).postMessage(s);
      },
      clear: function (topic) { localStorage.removeItem('bc:retain:' + topic); },
      subscribe: function (topic, h) {
        (handlers[topic] = handlers[topic] || []).push(h);
        chan(topic);
        var r = localStorage.getItem('bc:retain:' + topic);
        if (r) setTimeout(function () { h(r); }, 30);
      },
      close: function () { Object.keys(chans).forEach(function (k) { chans[k].close(); }); }
    };
  }

  function MqttTransport(brokerIndex, onStatus) {
    var handlers = {}, client, connected = false;
    var ready = new Promise(function (resolve, reject) {
      client = window.mqtt.connect(BROKERS[brokerIndex], {
        clientId: 'bc_' + Math.random().toString(36).slice(2, 12),
        keepalive: 30, reconnectPeriod: 2000, connectTimeout: 8000, clean: true
      });
      var timer = setTimeout(function () { if (!connected) { reject(new Error('timeout')); } }, 9000);
      client.on('connect', function () {
        connected = true; clearTimeout(timer); onStatus && onStatus('online');
        Object.keys(handlers).forEach(function (t) { client.subscribe(t, { qos: 1 }); });
        resolve();
      });
      client.on('reconnect', function () { onStatus && onStatus('reconnecting'); });
      client.on('offline', function () { onStatus && onStatus('offline'); });
      client.on('error', function () { if (!connected) { clearTimeout(timer); reject(new Error('error')); } });
      client.on('message', function (topic, payload) {
        var s = payload.toString();
        (handlers[topic] || []).forEach(function (h) { h(s); });
      });
    });
    return {
      ready: ready,
      publish: function (topic, obj, retain) {
        client.publish(topic, JSON.stringify(obj), { qos: retain ? 1 : 0, retain: !!retain });
      },
      clear: function (topic) { client.publish(topic, '', { qos: 1, retain: true }); },
      subscribe: function (topic, h) {
        (handlers[topic] = handlers[topic] || []).push(h);
        if (connected) client.subscribe(topic, { qos: 1 });
      },
      close: function () { try { client.end(true); } catch (e) {} }
    };
  }

  var local = /[?&]local=1/.test(location.search);

  // Bağlan: belirli bir sunucu ya da sırayla dene
  function connect(preferred, onStatus) {
    if (local) return Promise.resolve({ t: LocalTransport(), broker: 0 });
    var order = [];
    if (preferred != null && BROKERS[preferred]) order.push(preferred);
    BROKERS.forEach(function (_, i) { if (order.indexOf(i) < 0) order.push(i); });
    return (function tryNext(k) {
      if (k >= order.length) return Promise.reject(new Error('Sunucuya bağlanılamadı'));
      var t = MqttTransport(order[k], onStatus);
      return t.ready.then(function () { return { t: t, broker: order[k] }; },
        function () { t.close(); return tryNext(k + 1); });
    })(0);
  }

  // Bir odanın verilen sunucuda olup olmadığına bak (kayıtlı durum mesajını bekler)
  function probe(transport, code, ms) {
    return new Promise(function (resolve) {
      var done = false;
      transport.subscribe(PREFIX + code + '/s', function (s) { if (!done && s) { done = true; resolve(true); } });
      setTimeout(function () { if (!done) { done = true; resolve(false); } }, ms);
    });
  }

  window.Net = { BROKERS: BROKERS, PREFIX: PREFIX, connect: connect, probe: probe, local: local, MqttTransport: MqttTransport };
})();
