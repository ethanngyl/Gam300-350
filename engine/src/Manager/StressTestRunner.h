#pragma once

#include <QString>

#include <cstddef>
#include <vector>

class Viewport;

//One timed step of a stress test, shown as a row in the stress test panel
struct StressResult {
	QString name;        //e.g. "Load: apply"
	size_t splatCount;   //Splats the step worked on
	double ms;           //Time the step took
	QString tooltip;     //Simple explanation of the step, shown when hovering its row
};

//Runs the automated stress tests and times them. No UI, the panel only displays what comes back.
//Tests act on the scene of the viewport it is given.
class StressTestRunner {
public:
	explicit StressTestRunner(Viewport* viewport) : m_viewport(viewport) {}

	//Generates a sphere and adds it to the scene, timing each phase
	//Returns nothing if the renderer is not ready or the scene is full
	//Phases: generating the splats, handing them to the renderer, and the first frame after
	//(the renderer defers its GPU upload to the next draw, so that frame is where the real load cost is).
	std::vector<StressResult> TestLoad(size_t count);

	//Selects every splat, every 2nd and every 10th splat of the selected model, timing each then times clearing the selection.
	//The selection is cleared when it finishes
	//Returns nothing if the renderer is not ready or no model is selected
	//Each selection is timed in two steps: building the indices and handing them to the renderer,then the first frame after
	//(the renderer re-marks the selected splats and uploads on its next draw)
	std::vector<StressResult> TestSelect();

	//Moves the selected model, then all, half and a selected tenth of its splats, timing each
	//Uses the same undoable commands as the editor, on a private undo stack so the editor's undo history is untouched
	//Every move is undone afterwards, so the model ends up exactly as it started
	//Returns nothing if the renderer is not ready or no model is selected
	//Each move is timed in two steps: the apply (building the undo data and changing the splats in memory)
	//and the first frame after (uploading the changed splats and drawing)
	std::vector<StressResult> TestMove();

	//Deletes half and a selected tenth of the selected model's splats, then deletes a whole model, timing each
	//Splat deletes use the editor's undoable command on a private undo stack and are undone afterwards
	//The model delete cannot be undone, so it deletes a temporary copy of the model made just for the test
	//Splat deletes only remove part of the model. Deleting every splat deletes the model in the editor,
	//so that case is the model delete below
	//Returns nothing if the renderer is not ready or no model is selected
	//Each delete is timed in two steps: the apply (removing in memory) and the first frame after (uploading what is left and drawing)
	std::vector<StressResult> TestDelete();

private:
	Viewport* m_viewport;
};
