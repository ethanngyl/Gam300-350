#pragma once

#include "../Manager/StressTestRunner.h"

#include <QList>
#include <QWidget>

#include <vector>

class QLabel;
class QPushButton;
class QTableWidget;

class StressTestPanel : public QWidget {
	Q_OBJECT

public:
	explicit StressTestPanel(QWidget* parent = nullptr);
	~StressTestPanel() override;

	//Appends one row per result to the table
	void AddResults(const std::vector<StressResult>& results);

	//While a test runs the buttons that start tests are disabled
	//Stop is only usable if the run can be stopped (Test All, between tests)
	void SetRunning(bool running, bool stoppable);

	//Singal to run various stress tests
signals:
	void loadTestRequested();
	void selectTestRequested();
	void moveTestRequested();
	void deleteTestRequested();
	void undoRedoTestRequested();
	void testAllRequested();
	void stopRequested();

private:
	//Shows the explanation of the selected row under the table, or a hint if no row is selected
	void ShowSelectedDescription();

	QTableWidget* m_results = nullptr;
	QLabel* m_description = nullptr;
	QList<QPushButton*> m_runButtons; //Every button that starts something, disabled while a test runs
	QPushButton* m_stopButton = nullptr;
};
