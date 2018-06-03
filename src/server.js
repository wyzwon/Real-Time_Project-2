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

const sandArrayX = 150;// 600;
const sandArrayY = 100;// 400;
const suggestedPixelSize = 4;// 2;

const enumActType = Object.freeze({ stayActive: 1, changeTile: 2 });

// Note: air === void === eraser
const enumSandType = Object.freeze({
  air: 1,
  sand: 2,
  water: 3,
  salt: 4,
  stone: 5,
  saltWater: 6,
  seaweed: 7,
});

const densityDict = {};
densityDict[enumSandType.air] = 0;
densityDict[enumSandType.sand] = 1.92;
densityDict[enumSandType.water] = 1;
densityDict[enumSandType.salt] = 2.1;
// densityDict[sandStone] = -1;
densityDict[enumSandType.saltWater] = 1.027;
// densityDict[seaweed] = -1;


// Instantiate the entire map as empty air cells
let sandArray = new Array(sandArrayX);
for (let i = 0; i < sandArray.length; i++) {
  sandArray[i] = new Array(sandArrayY);
  sandArray[i].fill(enumSandType.air);
}

let incomingChangeBuffer = {};
let outGoingChangeBuffer = {};

// Stores a list of all cells that need updating next frame
let futureUpdateBuffer = {};
let activeUpdateBuffer = {};

// Holds the requested actions for the frame
let actionHolder = {};
// Holds a list of the action groups
let actionBundleHolder = {};

let moved = false;

// Instantiate an array of empty cells to reset the scene with.
const blankBufferArray = sandArray.map(row => row.slice());


// https://stackoverflow.com/questions/25492329/is-array-slice-enough-to-handle-a-multidimensional-array-in-javascript
// Stores requested changes between consolidations and is instantiated and reset to all 0 values
// const oldScene = blankBufferArray.map(row => row.slice());

const tileChanger = (tile) => {
  // Record the changes so they can be passed to the users
  outGoingChangeBuffer[`${tile.x},${tile.y}`] = tile;

  // Commit the changes to the main scene array
  sandArray[tile.x][tile.y] = tile.type;

  // Add the tile and 4 surrounding tiles to the next frame update
  futureUpdateBuffer[`${tile.x},${tile.y}`] = { x: tile.x, y: tile.y };
  if (tile.y > 0) { // Up
    futureUpdateBuffer[`${tile.x},${(tile.y - 1)}`] = { x: tile.x, y: (tile.y - 1) };
  }
  const pHeight = (tile.y + 1);
  if (pHeight < sandArrayY) { // Down
    futureUpdateBuffer[`${tile.x},${(tile.y + 1)}`] = { x: tile.x, y: (tile.y + 1) };

    // Since we have confirmed the lower row exists,
    // take the opportunity to update plants if the tile is water
    if (tile.type === enumSandType.water) {
      const cellEdgeW = (tile.x + 3);

      // Minimum boundary checks
      if ((tile.x > 1) && (tile.x < (sandArrayX - 2))) {
        // Iterate through the 5 tiles horizontally below
        for (let p = (tile.x - 2); p < cellEdgeW; p++) {
          // Check if the tile is plant and not directly below (already activated by default)
          if ((sandArray[p][pHeight] === enumSandType.seaweed) && (p !== tile.x)) {
            futureUpdateBuffer[`${p},${pHeight}`] = { x: p, y: pHeight };
          }
        }
      }
      // count border tiles with more out of bounds checks
      else {
        // Iterate through the 5 tiles horizontally above until the right edge
        for (let p = (tile.x - 2); ((p < cellEdgeW) && (p < sandArrayX)); p++) {
          // skip pre left edge tiles
          if (p > -1) {
            // Check if the tile is plant and not directly below (already activated by default)
            if ((sandArray[p][pHeight] === enumSandType.seaweed) && (p !== tile.x)) {
              futureUpdateBuffer[`${p},${pHeight}`] = { x: p, y: pHeight };
            }
          }
        }
      }
    }
  }
  if (tile.x > 0) { // Left
    futureUpdateBuffer[`${(tile.x - 1)},${tile.y}`] = { x: (tile.x - 1), y: (tile.y) };
  }
  if (tile.x < sandArrayX - 1) { // Right
    futureUpdateBuffer[`${(tile.x + 1)},${tile.y}`] = { x: (tile.x + 1), y: (tile.y) };
  }
};

const actionManager = (actReq) => {
  const changeListKeysAct = Object.keys(actReq.actionBundles);

  // Unpack the actionBundles in actReq
  for (let i = 0; i < changeListKeysAct.length; i++) {
    const actionBundle = actReq.actionBundles[changeListKeysAct[i]];

    // assign the actionBundle a unique identifier
    // based on the calling tiles coordinates and the bundle index
    const BundleID = `${actReq.x},${actReq.y},${i}`;

    // Instantiate the object location
    actionBundleHolder[BundleID] = {};


    const changeListKeys = Object.keys(actionBundle);

    for (let j = 0; j < changeListKeys.length; j++) {
      const action = actionBundle[changeListKeys[j]];
      // action.BundleID = BundleID;

      // create the slot if it doesn't exist
      if (!actionHolder[`${action.tile.x},${action.tile.y}`]) {
        actionHolder[`${action.tile.x},${action.tile.y}`] = {};
      }

      // Add the action into the queue
      actionHolder[`${action.tile.x},${action.tile.y}`][BundleID] = action;

      // save coordinates to the bundle list
      actionBundleHolder[BundleID][`${action.tile.x},${action.tile.y}`] = { x: action.tile.x, y: action.tile.y };
    }
  }
};

// Resolve action conflicts by selecting one action for each space
// and deleting the other actions and all other actions in their bundle.
const decisionManager = () => {
  const changeListKeysAH = Object.keys(actionHolder);
  /* console.log("decision manager called");
  console.log("actionHolder1");
  console.log(actionHolder); */
  // Skip if there are no keys
  if (changeListKeysAH.length > 0) {
    // Iterate through coordinates in actionHolder
    for (let i = 0; i < changeListKeysAH.length; i++) {
      const changeListKeysCell = Object.keys(actionHolder[changeListKeysAH[i]]);

      // Record the initial size of the object
      const startSize = changeListKeysCell.length;

      // Skip if there is only one key
      if (startSize > 1) {
        // Select the action to keep
        const randomAction = Math.floor(Math.random() * startSize);

        // find the action bundles for all rejected actions and delete them
        for (let j = (startSize - 1); j >= 0; j--) {
          // Ignore the kept action
          if (j !== randomAction) {
            // Extract the bundleID from the target action
            const BundleID = changeListKeysCell[j];

            // use the key (which is the bundleID)
            // to Identify the actionBundle in actionBundleHolder
            // then grab the keys in that actionBundle
            const changeListKeysAB = Object.keys(actionBundleHolder[BundleID]);
            // Iterate through the actions tied to this bundle
            for (let k = 0; k < changeListKeysAB.length; k++) {
              // Delete the action
              // console.log("deleting:");
              // console.log(actionHolder[changeListKeysAB[k]][BundleID]);
              delete actionHolder[changeListKeysAB[k]][BundleID];
            }
            // There is currently no use for deleting this but this is where it would happen
            // delete actionBundleHolder[BundleID];
          }
        }
      }
    }
  }
};

// commit all approved actions to the frame changes
const postManager = () => {
  const changeListKeys = Object.keys(actionHolder);

  // iterate through coordinates
  for (let i = 0; i < changeListKeys.length; i++) {
    const cell = actionHolder[changeListKeys[i]];

    const changeListKeysCell = Object.keys(cell);
    if (changeListKeysCell.length > 0) {
      // retrieve the action from the cell and commit it to the scene
      tileChanger(cell[changeListKeysCell[0]].tile);
    }
  }
};

// Returns true if the tile is a liquid or gas
const isLiquid = (tileType) => {
  switch (tileType) {
    case enumSandType.air:
    case enumSandType.water:
    case enumSandType.saltWater:
      return true;
    default:
      return false;
  }
};

// Confirm that it is possible to merge particles
const testSaltWaterMerge = (scX, scY) => {
  if (sandArray[scX][scY] === enumSandType.salt) {
    if (sandArray[scX][scY + 1] === enumSandType.water) {
      return true;
    }
  }
  else if (sandArray[scX][scY] === enumSandType.water) {
    if (sandArray[scX][scY + 1] === enumSandType.salt) {
      return true;
    }
  }

  return false;
};

// compare densities
const isDenser = (particle1, particle2) => (densityDict[particle1] > densityDict[particle2]);

// Sand instructions
const updateSand = () => {
  const changeListKeys = Object.keys(activeUpdateBuffer);

  // iterate through the active tiles
  for (let i = 0; i < changeListKeys.length; i++) {
    const tile = activeUpdateBuffer[changeListKeys[i]];
    const scX = tile.x;// sceneX
    const scY = tile.y;// sceneY
    tile.type = sandArray[scX][scY];

    // reset moved flag
    moved = false;

    switch (tile.type) {
      // These tile types have no active behavior
      case enumSandType.air:
      case enumSandType.stone:
        break;
      // These tile types all obey fluid behavior
      case enumSandType.sand:
      case enumSandType.water:
      case enumSandType.salt:
      case enumSandType.saltWater:

        // check if the spot bellow it exists
        if ((scY + 1) < sandArrayY) {
          // check if the spot below is empty and if so move into it
          if (sandArray[scX][scY + 1] === enumSandType.air) {
            // disperse in air by very occasionally not falling
            if (Math.floor((Math.random() * 32)) !== 1) {
              const actions = {};
              let actTile = { x: scX, y: scY, type: enumSandType.air };
              actions[`${scX},${scY}`] = { tile: actTile, actType: enumActType.changeTile };

              actTile = { x: scX, y: scY + 1, type: sandArray[scX][scY] };
              actions[`${scX},${scY + 1}`] = { tile: actTile, actType: enumActType.changeTile };

              const actBundles = {};
              actBundles[1] = actions;

              // Send the actions to be processed
              actionManager({ x: scX, y: scY, actionBundles: actBundles });

              moved = true;
            }
          }
          // Attempt to Merge
          else if (testSaltWaterMerge(scX, scY)) {
            const actions = {};
            let actTile = { x: scX, y: scY, type: enumSandType.air };
            actions[`${scX},${scY}`] = { tile: actTile, actType: enumActType.changeTile };

            actTile = { x: scX, y: scY + 1, type: enumSandType.saltWater };
            actions[`${scX},${scY + 1}`] = { tile: actTile, actType: enumActType.changeTile };

            const actBundles = {};
            actBundles[1] = actions;

            // Send the actions to be processed
            actionManager({ x: scX, y: scY, actionBundles: actBundles });

            // tileChanger({ x: scX, y: scY, type: sandVoid });
            // tileChanger({ x: scX, y: (scY + 1), type: sandSaltWater });
            moved = true;
          }
          // Sink if denser then the pixel below
          else if (isLiquid(sandArray[scX][scY + 1])) {
            if (isDenser(sandArray[scX][scY], sandArray[scX][scY + 1])) {
              // Randomly abort sinking for viscosity effects
              if (Math.floor(Math.random() * (2)) === 1) {
                const actions = {};
                let actTile = { x: scX, y: scY + 1, type: sandArray[scX][scY] };
                actions[`${scX},${scY + 1}`] = { tile: actTile, actType: enumActType.changeTile };

                actTile = { x: scX, y: scY, type: sandArray[scX][scY + 1] };
                actions[`${scX},${scY}`] = { tile: actTile, actType: enumActType.changeTile };

                const actBundles = {};
                actBundles[1] = actions;

                // Send the actions to be processed
                actionManager({ x: scX, y: scY, actionBundles: actBundles });

                // tileChanger({ x: scX, y: (scY + 1), type: oldScene[scX][scY] });
                // tileChanger({ x: scX, y: scY, type: oldScene[scX][scY + 1] });
                moved = true;
              }
            }
          }
        }
        // If the particle didn't fall, try moving to the side
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
            // If the side tile in question is liquid or air
            if (isLiquid(sandArray[scX + dirMod][scY])) {
              // Make sure the particle can be swapped
              // If the two particles are not the same type
              if ((sandArray[scX][scY] !== sandArray[scX + dirMod][scY])) {
                // If the particle is denser then the one it's moving to in the new scene
                if (isDenser(sandArray[scX][scY], sandArray[scX + dirMod][scY])) {
                  const actions = {};
                  let actTile = { x: scX, y: scY, type: sandArray[scX + dirMod][scY] };
                  actions[`${scX},${scY}`] = { tile: actTile, actType: enumActType.changeTile };

                  actTile = { x: scX + dirMod, y: scY, type: sandArray[scX][scY] };
                  actions[`${scX + dirMod},${scY}`] = { tile: actTile, actType: enumActType.changeTile };

                  const actBundles = {};
                  actBundles[1] = actions;

                  // Send the actions to be processed
                  actionManager({ x: scX, y: scY, actionBundles: actBundles });

                  // tileChanger({ x: scX, y: scY, type: oldScene[scX + dirMod][scY] });
                  // tileChanger({ x: (scX + dirMod), y: scY, type: oldScene[scX][scY] });
                  moved = true;
                }
              }
            }
          }
        }

        // If the particle still hasn't made a move this turn, check to see if it's possible
        // to move anywhere and if so, add it back to the list to check next frame.
        // For each direction it checks if
        // 1: The spot exists
        // 2: The particle is liquid
        // 3: The particle in that spot is less dense
        if (!moved) {
          let completed = false;
          // If it's possible to move left
          if ((scX > 0) && isLiquid(sandArray[scX - 1][scY])) {
            if (isDenser(sandArray[scX][scY], sandArray[scX - 1][scY])) {
              futureUpdateBuffer[`${(scX)},${scY}`] = { x: (scX), y: (scY) };
              completed = true;
            }
          }
          // If it's possible to move right
          if (!completed && (scX < sandArrayX - 1) && isLiquid(sandArray[scX + 1][scY])) {
            if (isDenser(sandArray[scX][scY], sandArray[scX + 1][scY])) {
              futureUpdateBuffer[`${(scX)},${scY}`] = { x: (scX), y: (scY) };
              completed = true;
            }
          }
          // If it's possible to move down
          if (!completed && ((scY + 1) < sandArrayY)) {
            if (isDenser(sandArray[scX][scY], sandArray[scX][scY + 1])) {
              futureUpdateBuffer[`${(scX)},${scY}`] = { x: (scX), y: (scY) };
            }
          }
        }
        break;

      case enumSandType.seaweed:

        // If there is another row to grow into
        if (scY > 0) {
          // Check if there is water to spread into
          let wP = false;

          const cellEdgeW = (scX + 3);
          const pHeight = (scY - 1);

          // Minimum boundary checks
          if ((scX > 1) && (scX < (sandArrayX - 2))) {
            // Iterate through the 5 tiles horizontally above
            for (let p = (scX - 2); ((p < cellEdgeW) && !wP); p++) {
              // Check if the tile is water and update the flag
              if (sandArray[p][pHeight] === enumSandType.water) {
                // waterPresent
                wP = true;
              }
            }
          }
          // count border tiles with more out of bounds checks
          else {
            // Iterate through the 5 tiles horizontally above until the right edge
            for (let p = (scX - 2); ((p < cellEdgeW) && (p < sandArrayX) && !wP); p++) {
              // skip pre left edge tiles
              if (p > -1) {
                // Check if the tile is water and update the flag
                if (sandArray[p][pHeight] === enumSandType.water) {
                  wP = true;
                }
              }
            }
          }

          if (wP) {
            // Determine how many plants exist in the 7 tiles above this 1
            // plantsAbove
            let pA = 0;

            const cellEdge = (scX + 5);

            // Minimum boundary checks
            if ((scX > 3) && (scX < (sandArrayX - 4))) {
              // Iterate through the 9 tiles horizontally above
              for (let p = (scX - 4); ((p < cellEdge) && (pA < 3)); p++) {
                // Check if the tile is a plant and update the counter
                if (sandArray[p][pHeight] === enumSandType.seaweed) {
                  pA++;
                }
              }
            }
            // count border tiles with more out of bounds checks
            else {
              // Iterate through the 9 tiles horizontally above until the right edge
              for (let p = (scX - 3); ((p < cellEdge) && (p < sandArrayX) && (pA < 3)); p++) {
                // skip pre left edge tiles
                if (p > -1) {
                  // Check if the tile is a plant and update the counter
                  if (sandArray[p][pHeight] === enumSandType.seaweed) {
                    pA++;
                  }
                }
              }
            }

            // Grow if it's clear enough
            if (pA < 2) {
              // choose a cell to try to grow into
              let targetX = 0;
              switch (Math.floor((Math.random() * 5))) {
                case 0:
                  targetX = scX;
                  break;
                case 1:
                  targetX = (scX - 1);
                  break;
                case 2:
                  targetX = (scX + 1);
                  break;
                case 3:
                  targetX = (scX - 2);
                  break;
                case 4:
                  targetX = (scX + 2);
                  break;
                default:
                  break;
              }

              // Grow if the tile chosen is valid
              if ((targetX > -1) && (targetX < sandArrayX)) {
                if (sandArray[targetX][pHeight] === enumSandType.water) {
                  const actions = {};
                  const actTile = { x: targetX, y: pHeight, type: enumSandType.seaweed };
                  actions[`${scX},${scY}`] = { tile: actTile, actType: enumActType.changeTile };

                  const actBundles = {};
                  actBundles[0] = actions;

                  // Send the actions to be processed
                  actionManager({ x: scX, y: scY, actionBundles: actBundles });
                }
              }

              // Keep putting this cell back on the buffer till it's no longer able to grow
              futureUpdateBuffer[`${(scX)},${scY}`] = { x: (scX), y: (scY) };
            }
          }
        }


        break;

      default:
        console.log('Warning: unrecognized tile type');
        break;
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

const onFullUpdateRequest = (sock) => {
  const socket = sock;

  socket.on('fullUpdateRequest', () => {
    // Send the current map data to the user
    socket.emit('fullUpdate', sandArray);
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
  onFullUpdateRequest(socket);
  onDisconnect(socket);
  onArrayUpdateToServer(socket);
  onClearRequest(socket);
});

const mainGameLoop = () => {

  // Move the list of tiles to the working list
  activeUpdateBuffer = {};
  Object.assign(activeUpdateBuffer, futureUpdateBuffer);
  futureUpdateBuffer = {};

  // Run the sand simulation loop
  updateSand();
  // Reset the active update buffer
  activeUpdateBuffer = {};
  // Resolve move conflicts
  decisionManager();
  // Save the actions
  postManager();

  // clear holders
  actionHolder = {};
  actionBundleHolder = {};

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
};

setInterval(() => {
  mainGameLoop();
}, 70);

console.log('Websocket server started');

