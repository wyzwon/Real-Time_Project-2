const http = require('http');
const fs = require('fs');
const socketio = require('socket.io');

const port = process.env.PORT || process.env.NODE_PORT || 3000;

// read the client html file into memory
// __dirname in node is the current directory
// (in this case the same folder as the server js file)
const index = fs.readFileSync(`${__dirname}/../client/index.html`);
// const sandClient = fs.readFileSync(`${__dirname}/../client/scripts/Sand.js`);
const favicon = fs.readFileSync(`${__dirname}/../client/favicon.ico`);

const sandArrayX = 150;
const sandArrayY = 100;
const suggestedPixelSize = 4;

const sandVoid = 1;
const sandSand = 2;
const sandWater = 3;
const sandSalt = 4;
// const sandStone = 5;
const sandSaltWater = 6;

const densityDict = {};

densityDict[sandVoid] = 0;
densityDict[sandSand] = 1.92;
densityDict[sandWater] = 1;
densityDict[sandSalt] = 2.1;
// densityDict[sandStone] = -1;
densityDict[sandSaltWater] = 1.027;


// Instantiate the entire map as empty air cells
let sandArray = new Array(sandArrayX);
for (let i = 0; i < sandArray.length; i++) {
  sandArray[i] = new Array(sandArrayY);
  sandArray[i].fill(sandVoid);
}

let incomingChangeBuffer = {};
let outGoingChangeBuffer = {};

// Instantiate an array of empty cells to reset the scene with.
const blankBufferArray = sandArray.map(row => row.slice());


// https://stackoverflow.com/questions/25492329/is-array-slice-enough-to-handle-a-multidimensional-array-in-javascript
// Stores requested changes between consolidations and is instantiated and reset to all 0 values
let oldScene = blankBufferArray.map(row => row.slice());

const tileChanger = (tile) => {
  // Record the changes so they can be passed to the users
  outGoingChangeBuffer[`${tile.x},${tile.y}`] = tile;

  // Commit the changes to the main scene array
  sandArray[tile.x][tile.y] = tile.type;
};

const isFluid = (tile) => {
  if (tile !== 1 && tile !== 5) {
    return true;
  }

  return false;
};
const isFluidOrVoid = (tile) => {
  if (tile !== 5) {
    return true;
  }

  return false;
};
const isLiquid = (tile) => {
  if (tile === 1 || tile === 3 || tile === 6) {
    return true;
  }

  return false;
};

// compare densities
const isDenser = (particle1, particle2) => (densityDict[particle1] > densityDict[particle2]);

const updateSand = () => {
  // Loop through all the cells in the scene
  for (let scY = 0; scY < sandArray[0].length; scY++) { // sceneY loop
    for (let scX = 0; scX < sandArray.length; scX++) { // sceneX loop
      if (sandArray[scX][scY] !== sandVoid) {
        // check if the particle is the same in both scenes and therefore possibly unmoved
        if (sandArray[scX][scY] === oldScene[scX][scY]) {
          // check if the particle is fluid
          if (isFluid(oldScene[scX][scY])) {
            let moved = false;
            // check if the spot bellow it exists
            if ((scY + 1) < sandArrayY) {
              // check if the spot below is empty and if so move into it
              if (sandArray[scX][scY + 1] === sandVoid) {
                // disperse in air by very occasionally not falling
                if (Math.floor((Math.random() * 32)) !== 1) {
                  tileChanger({ x: scX, y: (scY + 1), type: oldScene[scX][scY] });
                  tileChanger({ x: scX, y: scY, type: sandVoid });
                }
                moved = true;
              }
              // Sink if denser then the pixel below
              else if (isLiquid(oldScene[scX][scY + 1])) {
                if (isDenser(oldScene[scX][scY], oldScene[scX][scY + 1])) {
                  // If the particle below is the same in both scenes
                  if (oldScene[scX][scY + 1] === sandArray[scX][scY + 1]) {
                    // Randomly abort sinking for viscosity effects
                    if (Math.floor(Math.random() * (2)) === 1) {
                      tileChanger({ x: scX, y: (scY + 1), type: oldScene[scX][scY] });
                      tileChanger({ x: scX, y: scY, type: oldScene[scX][scY + 1] });
                      moved = true;
                    }
                  }
                }
              }
            }

            if (!moved) {
              // Try to move left or right randomly
              const dispersalDirection = (Math.floor(Math.random() * (2)) === 1);

              // This block allows the same code to be used for movement in both directions
              // by switching out the coordinate used
              let dirMod; // properly "directionMod"  but shortened to comply with line length
              if (dispersalDirection) {
                dirMod = -1;
              }
              else {
                dirMod = 1;
              }

              // check if the tile is valid (in array boundary) to move to
              if ((((dirMod === -1) && (scX > 0)) || ((dirMod === 1) && (scX < sandArrayX - 1)))) {
                // If the tile in question is a fluid or void
                if (isLiquid(oldScene[scX + dirMod][scY])) {
                  // Make sure the particle can be swapped
                  // If the two particles are not the same type
                  if ((oldScene[scX][scY] !== sandArray[scX + dirMod][scY])) {
                    // If the particle is denser then the one it's moving to in the new scene
                    if (isDenser(sandArray[scX][scY], sandArray[scX + dirMod][scY])) {
                      // If the particle is denser then the one it's moving to in the old scene
                      if (isDenser(oldScene[scX][scY], oldScene[scX + dirMod][scY])) {
                        // If the particle is the same in both scenes
                        if (oldScene[scX][scY] === sandArray[scX][scY]) {
                          // If the position the particle is moving to is the same in both scenes
                          if (oldScene[scX + dirMod][scY] === sandArray[scX + dirMod][scY]) {
                            tileChanger({ x: scX, y: scY, type: oldScene[scX + dirMod][scY] });
                            tileChanger({ x: (scX + dirMod), y: scY, type: oldScene[scX][scY] });
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
};


const onRequest = (request, response) => {
  switch (request.url) {
    case '/':
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.write(index);
      response.end();
      break;
    /* case '/scripts/Sand.js':
      response.writeHead(200, { 'Content-Type': 'text/javascript' });
      response.write(sandClient);
      response.end();
      break; */
    case '/favicon.ico':
      response.writeHead(200, { 'Content-Type': 'image/x-icon' });
      response.write(favicon);
      response.end();
      break;
    default:
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.write(index);
      response.end();
      break;
  }
};

const app = http.createServer(onRequest).listen(port);

console.log(`Listening on 127.0.0.1: ${port}`);

// pass in the http server into socketio and grab the websocket server as io
const io = socketio(app);

const onJoined = (sock) => {
  const socket = sock;

  socket.on('join', () => {
    socket.join('room1');
    console.log(`${socket.id} joined room1`);

    // Send the current map data to the new user along with the suggested size of pixels
    socket.emit('setUp', { value: sandArray, suggestedPixelSize });
  });
};

const onMsg = (sock) => {
  const socket = sock;

  socket.on('msgToServer', (data) => {
    io.sockets.in('room1').emit('msg', { name: socket.name, msg: data.msg });
  });
};

const onDraw = (sock) => {
  const socket = sock;

  socket.on('draw', (data) => {
    socket.broadcast.emit('drawFromServer', data);
  });
};

const onArrayUpdateToServer = (sock) => {
  const socket = sock;

  socket.on('arrayUpdateToServer', (data) => {
    const changeListKeys = Object.keys(data);

    // Place each change in the local copy
    for (let i = 0; i < changeListKeys.length; i++) {
      const tile = data[changeListKeys[i]];

      // Assign the tile to the corresponding spot
      // If coordinates exists.
      if ((tile.x !== null) && (tile.y !== null)) {
        // If coordinates in bounds (and not undefined)
        if ((tile.x < sandArrayX) && (tile.y < sandArrayY) && (tile.x >= 0) && (tile.y >= 0)) {
          // If tile is valid
          if (tile.type) {
            // Add the changes to the changeBuffer
            incomingChangeBuffer[`${tile.x},${tile.y}`] = tile;
          }
        }
      }
    }
  });
};

const onClearRequest = (sock) => {
  const socket = sock;

  socket.on('clearRequest', () => {
    sandArray = blankBufferArray.map(row => row.slice());

    io.sockets.in('room1').emit('clearScene', {});
  });
};


const onDisconnect = (sock) => {
  const socket = sock;

  socket.on('disconnect', () => {
    console.log(`${socket.id} Left room1`);
    socket.leave('room1');
  });
};


io.sockets.on('connection', (socket) => {
  console.log(`${socket.id} connected`);

  // users[socket.id] = { socket };

  onJoined(socket);
  onMsg(socket);
  onDraw(socket);
  onDisconnect(socket);
  onArrayUpdateToServer(socket);
  onClearRequest(socket);
});

setInterval(() => {
  // Record the old frame to iterate through
  oldScene = sandArray.map(row => row.slice());

  // Run the sand simulation loop
  updateSand();

  const bufferListKeys = Object.keys(incomingChangeBuffer);

  // place each change in the local copy
  for (let i = 0; i < bufferListKeys.length; i++) {
    // Add the tile to the array
    tileChanger(incomingChangeBuffer[bufferListKeys[i]]);
  }

  // Send the changes that happened this frame to the client windows
  io.sockets.in('room1').emit('arrayUpdates', outGoingChangeBuffer);

  // Clear the buffers for use in the next cycle
  incomingChangeBuffer = {};
  outGoingChangeBuffer = {};
}, 70);

console.log('Websocket server started');

