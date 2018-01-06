const http = require('http');
const fs = require('fs');
const socketio = require('socket.io');

const port = process.env.PORT || process.env.NODE_PORT || 3000;

// read the client html file into memory
// __dirname in node is the current directory
// (in this case the same folder as the server js file)
const index = fs.readFileSync(`${__dirname}/../client/index.html`);

const sandArrayX = 150;
const sandArrayY = 100;
// const sandObject = {}; // This is the master array of the sand data

// Instantiate the entire map as empty air cells
const sandArray = new Array(sandArrayX);
for (let i = 0; i < sandArray.length; i++) {
  sandArray[i] = new Array(sandArrayY);
  sandArray[i].fill(1);
}

let changeBuffer = {};
changeBuffer = {};

// Instantiate an array of empty cells to reset the changeBufferArray with.
const blankBufferArray = new Array(sandArrayX);
for (let i = 0; i < sandArray.length; i++) {
  blankBufferArray[i] = new Array(sandArrayY);
  blankBufferArray[i].fill(0);
  // blankBufferArray[i].fill(Math.floor(Math.random() * (5)));
}

// https://stackoverflow.com/questions/25492329/is-array-slice-enough-to-handle-a-multidimensional-array-in-javascript
// Stores requested changes between consolidations and is instantiated and reset to all 0 values
const changeBufferArray = blankBufferArray.map(row => row.slice());


const onRequest = (request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.write(index);
  response.end();
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
    socket.emit('setUp', { value: sandArray, suggestedPixelSize: 4 });
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

    // place each change in the local copy
    for (let i = 0; i < changeListKeys.length; i++) {
      // console.log(data);
      const tile = data[changeListKeys[i]];

      // Assign the tile to the corresponding spot if it exists.
      if ((tile.x < sandArrayX) && (tile.y < sandArrayY)) {
        // save the changes to the server copy
        sandArray[tile.x][tile.y] = tile.type;

        // add the changes to the changeBufferArray
        changeBufferArray[tile.x][tile.y] = tile.type;

        // add the changes to the changeBuffer
        changeBuffer[`${tile.x},${tile.y}`] = { x: tile.x, y: tile.y, type: tile.type };

        // temporarily broadcast changes immediately
        io.sockets.in('room1').emit('arrayUpdates', data);
		
      }
    }
  });
};


const onDisconnect = (sock) => {
  const socket = sock;

  socket.on('disconnect', () => {
    console.log(`${socket.id} Left the chat room`);
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
});

setInterval(() => {
  const tilesArray = {};

  tilesArray[0] = { x: 2, y: 67, type: Math.floor(Math.random() * (5)) };
  tilesArray[1] = { x: 30, y: 22, type: Math.floor(Math.random() * (5)) };

  io.sockets.in('room1').emit('arrayUpdates', tilesArray);

  const bufferListKeys = Object.keys(changeBuffer);

  // place each change in the local copy
  for (let i = 0; i < bufferListKeys.length; i++) {
    const tile = changeBuffer[bufferListKeys[i]];

    // Assign the tile to the corresponding spot if it exists.
    if ((tile.x < sandArrayX) && (tile.y < sandArrayY)) {
      // save the changes to the server copy
      sandArray[tile.x][tile.y] = tile.type;
    }
  }
  
  //console.log(sandArray);
  // Clear the buffer for use in next cycle
  changeBuffer = {};
}, 300);

console.log('Websocket server started');

