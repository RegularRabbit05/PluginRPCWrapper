class Node {
	value;
	next;

	constructor(value) {
		this.value = value;
	}
}

class Queue {
//https://github.com/sindresorhus/yocto-queue
	#head;
	#tail;
	#size;

	constructor() {
		this.clear();
	}

	enqueue(value) {
		const node = new Node(value);

		if (this.#head) {
			this.#tail.next = node;
			this.#tail = node;
		} else {
			this.#head = node;
			this.#tail = node;
		}

		this.#size++;
	}

	dequeue() {
		const current = this.#head;
		if (!current) {
			return;
		}

		this.#head = this.#head.next;
		this.#size--;
		return current.value;
	}

	peek() {
		if (!this.#head) {
			return;
		}

		return this.#head.value;

		// TODO: Node.js 18.
		// return this.#head?.value;
	}

	clear() {
		this.#head = undefined;
		this.#tail = undefined;
		this.#size = 0;
	}

	get size() {
		return this.#size;
	}

	* [Symbol.iterator]() {
		let current = this.#head;

		while (current) {
			yield current.value;
			current = current.next;
		}
	}

	* drain() {
		while (this.#head) {
			yield this.dequeue();
		}
	}
}

import { DiscordSDK, RPCCloseCodes } from "@discord/embedded-app-sdk";
let auth;
window.gameEnv = {};
window.gameFunc = gameFunc;
window.popPacketFunc = popPacketFunc;
window.gws = undefined;
window.gwsq = new Queue();

const discordSdk = new DiscordSDK(import.meta.env.VITE_DISCORD_CLIENT_ID);

function logMessage(msg) {
  discordSdk.commands.captureLog({
    level: 'info',
    message: msg
  });
}

function openWebSocket() {
  window.gws = new WebSocket(`https://${import.meta.env.VITE_DISCORD_CLIENT_ID}.discordsays.com/api/v1/presence/${window.gameEnv["key"]}/receiver`);
  setTimeout(() => {
    if (window.gws.readyState !== WebSocket.OPEN) {
      logMessage("Sync server connection failed, retrying...");
      window.gws.close();
    }
  }, 1000);
}

setupDiscordSdk().then(() => {
  logMessage("Discord SDK is authenticated");
  discordSdk.commands.encourageHardwareAcceleration();
  openWebSocket();

  window.gws.addEventListener("error", (e) => {
    discordSdk.commands.captureLog({
      level: 'error',
      message: "Sync server fail with: " + e.code
    });
    openWebSocket();
  });

  window.gws.addEventListener("close", () => {
    if (window.gws && window.gws.closeCode === RPCCloseCodes.CLOSE_DOUBLE_LOGIN) {
      logMessage("Sync server connection failed: Double login detected. Please close other instances of the app.");
      closeApp();
      return;
    }
    logMessage("Sync server disconnect");
    openWebSocket();
  });

  async function parseWebsocketMessageLocal(msg) {
    let presenceData;
    try {
      presenceData = JSON.parse(msg);
    }
    catch (e) {
      discordSdk.commands.captureLog({
        level: 'error',
        message: "Failed to parse presence data: " + e.message
      });
      return;
    }
    if (presenceData == null || typeof presenceData !== "object") {
      discordSdk.commands.captureLog({
        level: 'error',
        message: "Received invalid presence data"
      });
      return;
    }
    if (presenceData.activate != null) {
      if (presenceData.activate) {
        window.gameEnv["showing"] = "true";
      } else {
        window.gameEnv["showing"] = "false";
        discordSdk.commands.setActivity({
          activity: {}
        });
      }
      return;
    }
    if (window.gameEnv["showing"] !== "true") {
      return;
    }
    if (presenceData.activities == null || !Array.isArray(presenceData.activities) || presenceData.activities.length === 0) {
      discordSdk.commands.captureLog({
        level: 'error',
        message: "Received presence data with no activities"
      });
      return;
    }
    discordSdk.commands.setActivity({
      activity: presenceData.activities[0]
    });
  }

  window.gws.addEventListener("message", (e) => {
    const msg = e.data.toString();
    window.gwsq.enqueue(msg);
    parseWebsocketMessageLocal(msg);
  });

  window.gws.addEventListener("open", () => {
    logMessage("Sync server connected");
    setInterval(() => {
      window.gws.send("");
    }, 10000);
    runApp();
  });
});

async function setupDiscordSdk() {
  logMessage("Preparing Discord SDK");
  await discordSdk.ready();
  logMessage("Discord SDK is ready");

  const { code } = await discordSdk.commands.authorize({
    client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: [
      "identify",
      "applications.commands",
      "rpc.activities.write",
    ],
  });

  const response = await fetch(`https://${import.meta.env.VITE_DISCORD_CLIENT_ID}.discordsays.com/ext/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      code,
    }),
  });
  const serverData = await response.json();
  let access_token = serverData.token;

  auth = await discordSdk.commands.authenticate({
    access_token,
  });

  if (auth == null) {
    throw new Error("Authenticate command failed");
  }

  const keyRequest = await fetch(`https://${import.meta.env.VITE_DISCORD_CLIENT_ID}.discordsays.com/ext/key`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      "token": access_token,
    }),
  });
  const keyData = await keyRequest.json();
  let access_key = keyData.key;

  window.gameEnv["key"] = access_key;
}

function closeApp() {
  setTimeout(() => {
    if (window.gws) window.gws.close();
    discordSdk.close(RPCCloseCodes.CLOSE_NORMAL, "App has returned");
  }, 500);
}

function popupUrl(url) {
  discordSdk.commands.openExternalLink({
    url: url,
  });
}

function gameFunc(cmd) {
  const parts = cmd.split(' ');
  switch (parts[0]) {
    case "close": closeApp(); break;
    case "url": popupUrl(parts[1]); break;
    default: discordSdk.commands.captureLog({
      level: 'error',
      message: "Received unknown rpc command: " + parts[0]
    });
  }
}

function popPacketFunc() {
  return window.gwsq.dequeue();
}

async function runApp() {
  logMessage("Starting game please wait...");
  var statusElement = document.querySelector('#status');
  var progressElement = document.querySelector('#progress');
  var spinnerElement = document.querySelector('#spinner');
  var canvas = document.querySelector('#canvas');
  canvas.addEventListener("webglcontextlost", function(e) { alert('WebGL context lost. You will need to reload the page.'); e.preventDefault(); closeApp(); }, false);

  Module = {
    preRun: [],
    postRun: [],
    print: (function() {
      return function(text) {
        if (arguments.length > 1) text = Array.prototype.slice.call(arguments).join(' ');
        logMessage(text);
      };
    })(),
    printErr: function(text) {
      if (arguments.length > 1) text = Array.prototype.slice.call(arguments).join(' ');
      discordSdk.commands.captureLog({
        level: 'error',
        message: text
      });
    },
    canvas: canvas,
    setStatus: function(text) {
      if (!Module.setStatus.last) Module.setStatus.last = { time: Date.now(), text: '' };
      if (text === Module.setStatus.last.text) return;
      var m = text.match(/([^(]+)\((\d+(\.\d+)?)\/(\d+)\)/);
      var now = Date.now();
      if (m && now - Module.setStatus.last.time < 30) return;
      Module.setStatus.last.time = now;
      Module.setStatus.last.text = text;
      if (m) {
        text = m[1];
        progressElement.value = parseInt(m[2])*100;
        progressElement.max = parseInt(m[4])*100;
        progressElement.hidden = true;
        spinnerElement.hidden = false;
      } else {
        progressElement.value = null;
        progressElement.max = null;
        progressElement.hidden = true;
        if (!text) spinnerElement.style.display = 'none';
      }
      statusElement.innerHTML = text;
    },
    totalDependencies: 0,
    monitorRunDependencies: function(left) {
      this.totalDependencies = Math.max(this.totalDependencies, left);
      Module.setStatus(left ? 'Preparing... (' + (this.totalDependencies-left) + '/' + this.totalDependencies + ')' : 'All downloads complete.');
    },
  };

  Module.setStatus('Downloading...');

  window.onerror = function() {
    Module.setStatus('Exception thrown, see JavaScript console');
    spinnerElement.style.display = 'none';
    Module.setStatus = function(text) { if (text) Module.printErr('[post-exception status] ' + text); };
  };

  var script = document.createElement('script');
  script.src = "dist/index.js";
  document.body.appendChild(script);
}